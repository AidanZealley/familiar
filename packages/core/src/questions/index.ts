import { BACKGROUND_CONTEXT, type Context } from '@earendil-works/chord/context'
import {
  defineDoc,
  defineExtension,
  hook,
  ToolTask,
  type Harness,
  type JsonObject,
  type RegistrySnapshot,
  type Tx,
} from '@earendil-works/pi-durable'
import {
  toolSettingsOf,
  ToolSettingsDocument,
} from '../connections/tool-settings.ts'
import type { Connection } from '../connections/index.ts'
import { mcpExtensionName } from '../mcp/connection.ts'
import type { Notify } from '../notify.ts'
import { pluginExtensionName, type FamiliarTool } from '../plugins/index.ts'
import { runOrigin } from '../rooms/status.ts'
import {
  Familiars,
  familiarIn,
  type FamiliarId,
} from '../workspace/familiars.ts'
import { formProblem, type Form, type FormContent } from './form.ts'

/**
 * Questions for the person while a Familiar works: Familiar asking before a
 * connection's tool runs, and an MCP server asking mid-call (elicitation).
 * Both wait here, the one owner of what's pending, until the person answers
 * in the chat, the call is stopped, or the workspace closes.
 *
 * They're kept in a document so clients see them through the same streams
 * as the rest of a turn, but a question lives only as long as what's
 * waiting for it: opening the workspace clears them all. After a restart a
 * gated call asks again, because Pi reruns a call from before its intent,
 * where the gate runs; a call the server was asking in is reported to the
 * model as interrupted, since MCP calls don't rerun.
 */

export type { Form, FormContent, FormField } from './form.ts'
export { parseForm } from './form.ts'

export type Question = {
  id: string
  /** Whose chat is waiting. */
  familiar: FamiliarId
  /** The call it's about, as the model made it. */
  callId: string
  /** The tool called, by its name in Pi, such as `mcp__topsail__start_print`. */
  tool: string
  /** When it was asked, in ms since the epoch. */
  at: number
} & (
  | {
      /** Familiar asking whether to run the call: approve or decline. */
      kind: 'tool'
      arguments: JsonObject
    }
  | {
      /** An MCP server asking mid-call. */
      kind: 'elicitation'
      server: string
      message: string
      /** Undefined for a form Familiar can't show, which can only be declined. */
      form?: Form
    }
  | {
      /**
       * A plugin's tool asking for values only it gets, such as a password.
       * They go to the waiting tool, never into the stored answer.
       */
      kind: 'private'
      /** The plugin's title, else its name: for the person. */
      plugin: string
      message: string
      form: Form
    }
)

/** Questions as asked, before they have an ID and a time. */
export type QuestionDraft = Question extends infer Q
  ? Q extends Question
    ? Omit<Q, 'id' | 'at'>
    : never
  : never

export type Answer =
  { action: 'accept'; content?: FormContent } | { action: 'decline' }

/**
 * How a question ended: the person's answer, or `moved-on` when they sent
 * the Familiar a new message instead (see `declineWaiting`).
 */
export type Outcome = Answer | { action: 'moved-on' }

type Pending = Question & { answer?: Outcome }

/** What's waiting for the person, by question ID. */
export const Questions = defineDoc<Record<string, Pending>>({
  kind: 'familiar.questions',
  version: 1,
  scope: 'session',
  initial: () => ({}),
  checkpointWhen: () => true, // small: always store it whole
})

/** The pending questions in `state`, oldest first, without their answers. */
export const pendingIn = (
  state: Readonly<Record<string, Pending>> | null | undefined,
  familiar?: FamiliarId,
): Question[] =>
  Object.values(state ?? {})
    .filter(
      (question) =>
        !question.answer &&
        (familiar === undefined || question.familiar === familiar),
    )
    .sort((a, b) => a.at - b.at)
    .map(({ answer: _, ...question }) => question as Question)

/** An answer that doesn't fit its question. */
export class QuestionError extends TypeError {}

/** An answer to a question that isn't waiting: answered, withdrawn or never asked. */
export class QuestionGone extends Error {}

/** `text` without `prefix`, or undefined if it doesn't start with it. */
const after = (text: string, prefix: string) =>
  text.startsWith(prefix) ? text.slice(prefix.length) : undefined

/**
 * The connection a tool of `registry` belongs to, and its name there.
 * Undefined for core's tools, including the tool search an MCP server's
 * extension carries.
 */
export function connectionToolOf(registry: RegistrySnapshot, name: string) {
  for (const { extension, tool } of registry.tools()) {
    if (tool.name !== name) {
      continue
    }
    const annotations = (tool as FamiliarTool).annotations
    const plugin = after(extension.name, pluginExtensionName(''))
    if (plugin !== undefined) {
      const connection: Connection = { kind: 'plugin', name: plugin }
      return { connection, tool: name, annotations }
    }
    const server = after(extension.name, mcpExtensionName(''))
    const own = server && after(name, `mcp__${server}__`)
    if (server && own) {
      const connection: Connection = { kind: 'mcp', name: server }
      return { connection, tool: own, annotations }
    }
  }
  return undefined
}

/**
 * The person sent a message to `familiars` instead of answering: each one's
 * waiting questions end as `moved-on`, so its turn goes on to read the
 * message rather than staying stuck behind them. In the commit that posts it.
 */
export async function declineWaiting(tx: Tx, familiars: readonly FamiliarId[]) {
  const questions = await tx.doc(Questions)
  for (const question of Object.values(questions)) {
    if (!question.answer && familiars.includes(question.familiar)) {
      question.answer = { action: 'moved-on' }
    }
  }
}

const short = (text: string, length = 200) =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text

export function createQuestions(
  harness: Harness,
  options: {
    registry: () => RegistrySnapshot
    notify?: Notify
    now?: () => number
  },
) {
  const context = BACKGROUND_CONTEXT

  // Each private question's slot while its `ask` waits: empty until the
  // commit that stores the accept fills it, and commits publish in order,
  // so `ask` never sees an accept without its values. An answer finds a
  // slot only while its `ask` is waiting, which deletes it as it stops
  // waiting, so values never outlive the wait. In memory only: a restart
  // ends the wait too.
  const privateValues = new Map<string, FormContent | undefined>()

  /** Tells the person, through the host, where to answer. */
  const announce = async (question: Question) => {
    const { name, room } = await harness.commit(async (tx) => {
      const familiars = await tx.doc(Familiars)
      // The room its run is replying in, if any.
      const origin = await runOrigin(tx, question.familiar)
      return {
        name: familiars.familiars[question.familiar]?.name ?? 'A Familiar',
        room: origin?.room,
      }
    }, context)
    await options.notify?.({
      title: `${name} needs your OK`,
      body: short(
        question.kind === 'tool' ? `Run ${question.tool}?` : question.message,
      ),
      url: room === undefined ? '/' : `/room/${room}`,
    })
  }

  /**
   * Asks the person and waits for their answer. Cancelling `context` stops
   * waiting and withdraws the question. A gated call asked again after a
   * restart reuses its question. An accepted private question returns its
   * values here; they're never stored.
   */
  const ask = async (draft: QuestionDraft, waiting: Context) => {
    waiting.abortSignal?.throwIfAborted()
    const { question, asked } = await harness.commit(async (tx) => {
      const questions = await tx.doc(Questions)
      const existing = Object.values(questions).find(
        (question) =>
          draft.kind === 'tool' &&
          question.kind === 'tool' &&
          question.familiar === draft.familiar &&
          question.callId === draft.callId,
      )
      if (existing) {
        return { question: existing as Question, asked: false }
      }
      const question = {
        ...draft,
        id: crypto.randomUUID(),
        at: (options.now ?? Date.now)(),
      } as Question
      questions[question.id] = question
      return { question, asked: true }
    }, context)
    if (question.kind === 'private') {
      privateValues.set(question.id, undefined)
    }
    if (asked) {
      void announce(question).catch(() => {})
    }
    // Fails only as the workspace closes, when no answer can commit either.
    const watch = (await harness.watchDoc(Questions, context))!
    try {
      const outcome = await new Promise<Outcome>((resolve, reject) => {
        const check = (state: Readonly<Record<string, Pending>> | null) => {
          const current = state?.[question.id]
          if (current?.answer) {
            resolve(current.answer)
          } else if (!current) {
            reject(new Error('The question was withdrawn.'))
          }
        }
        const signal = waiting.abortSignal
        signal?.throwIfAborted()
        signal?.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        })
        void watch.closed.then(() =>
          reject(new Error('The workspace closed before an answer came.')),
        )
        // Each call delivers the newest value, which `value` then holds.
        watch.start(async () => check(watch.value))
        check(watch.value)
      })
      const values = privateValues.get(question.id)
      return values && outcome.action === 'accept'
        ? ({ action: 'accept', content: values } satisfies Outcome)
        : outcome
    } finally {
      privateValues.delete(question.id)
      await watch.stop()
      await harness
        .commit(async (tx) => {
          delete (await tx.doc(Questions))[question.id]
        }, context)
        .catch(() => {}) // closing: the next open clears it
    }
  }

  /**
   * Gives `familiar`'s question `id` its answer. Throws QuestionGone when
   * it isn't waiting, and a QuestionError when the answer doesn't fit it.
   * A private question's values go to its waiting `ask`; its stored answer
   * is the action alone.
   */
  const answer = (familiar: FamiliarId, id: string, answer: Answer) =>
    harness.commit(async (tx) => {
      const question = (await tx.doc(Questions))[id]
      if (!question || question.familiar !== familiar || question.answer) {
        throw new QuestionGone('That question is no longer waiting.')
      }
      if (answer.action === 'accept') {
        const problem =
          question.kind === 'tool'
            ? answer.content === undefined
              ? undefined
              : 'Approving a call takes no content.'
            : question.form
              ? formProblem(question.form, answer.content ?? {})
              : "Familiar can't show this form, so it can only be declined."
        if (problem) {
          throw new QuestionError(problem)
        }
      }
      if (question.kind === 'private') {
        if (!privateValues.has(id)) {
          throw new QuestionGone('That question is no longer waiting.')
        }
        if (answer.action === 'accept') {
          privateValues.set(id, answer.content ?? {})
        }
        question.answer = { action: answer.action }
      } else {
        question.answer = answer
      }
    }, context)

  /** Before a connection's tool or a destructive Familiar tool runs, asks or applies the owner's settings. */
  const extension = defineExtension({
    name: 'familiar.questions',
    hooks: [
      hook(ToolTask, {
        beforeTool: async (call, api, context) => {
          const registry = options.registry()
          const found = connectionToolOf(registry, call.name)
          // Familiar's own destructive tools always ask; the owner sets the
          // rest per connection.
          const destructive =
            !found &&
            registry
              .tools()
              .some(
                ({ tool }) =>
                  tool.name === call.name &&
                  (tool as FamiliarTool).annotations?.destructiveHint === true,
              )
          if (!found && !destructive) {
            return undefined
          }
          const settings = async () =>
            found
              ? toolSettingsOf(
                  await api.snapshot(ToolSettingsDocument, context),
                  found.connection,
                  found.tool,
                  found.annotations,
                )
              : { enabled: true, askBeforeRunning: true }
          const off = {
            block: `The owner has turned ${call.name} off in Familiar.`,
          }
          const { enabled, askBeforeRunning } = await settings()
          if (!enabled) {
            return off
          }
          if (!askBeforeRunning) {
            return undefined
          }
          const familiars = await api.snapshot(Familiars, context)
          const reply = await ask(
            {
              kind: 'tool',
              familiar:
                (familiars && familiarIn(familiars, api.conversationId)) ??
                api.conversationId,
              // A nested call shows under the call that made it.
              callId: call.parent?.callId ?? call.id,
              tool: call.name,
              arguments: call.arguments as JsonObject,
            },
            context,
          )
          if (reply.action === 'accept') {
            return (await settings()).enabled ? undefined : off
          }
          return {
            block:
              reply.action === 'moved-on'
                ? "The person sent a new message instead of answering, so this call didn't run."
                : 'The person declined this call.',
          }
        },
      }),
    ],
  })

  return {
    ask,
    answer,
    extension,
    /** Clears what an earlier process left: nothing waits for it now. */
    clear: (tx: Tx) =>
      tx.doc(Questions).then((questions) => {
        for (const id of Object.keys(questions)) {
          delete questions[id]
        }
      }),
  }
}

export type QuestionsApi = ReturnType<typeof createQuestions>
