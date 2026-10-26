import type { Context } from '@earendil-works/chord'
import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import {
  configure,
  defineDoc,
  defineExtension,
  defineTask,
  ResetEntry,
  ROOT_CONVERSATION_ID,
  type Extension,
  type ConversationId,
  type EntryId,
  type Harness,
  type ModelRef,
  type TaskId,
  type Tx,
} from '@earendil-works/pi-durable'
import { saidBy } from '../conversation/message.ts'
import { Memory } from './memory.ts'
import { coreFacts } from './facts.ts'

/** Passes run daily at this hour, in the host's time zone. */
const UPKEEP_HOUR = 4

/** The first upkeep time after `now`. */
export function nextUpkeep(now: number) {
  const next = new Date(now)
  next.setHours(UPKEEP_HOUR, 0, 0, 0)
  if (next.getTime() <= now) next.setDate(next.getDate() + 1)
  return next.getTime()
}

export type UpkeepState = {
  /** Where passes run: a conversation of its own, never shown to people. */
  conversation: ConversationId | null
  /** The one task that schedules passes. */
  task: TaskId | null
  /** The newest main-conversation entry a pass has reviewed. */
  through: EntryId | null
}

/** How Familiar finds its memory upkeep again after a restart. */
export const Upkeep = defineDoc<UpkeepState>({
  kind: 'familiar.upkeep',
  version: 1,
  scope: 'session',
  initial: () => ({ conversation: null, task: null, through: null }),
  checkpointWhen: () => true, // tiny: always store it whole
})

type UpkeepStep =
  | { phase: 'schedule' }
  /** Asleep until the next 04:00, then looks for new messages. */
  | { phase: 'pass' }
  /** Built in `pass`, so a rerun after a restart submits the same input. */
  | {
      phase: 'consolidate'
      conversation: ConversationId
      reset: EntryId
      newest: EntryId
      input: string
    }

const instructions = (name: string) =>
  `You keep the long-term memory of ${name}, a personal assistant, tidy. Nobody reads this conversation. Each message gives you the assistant's recent conversation with the people it helps, and when each saved fact was last written. Review the saved facts against it, using only recall, remember, revise_memory and retire:

- Before saving or correcting anything, recall it with a short, specific search: it may already be saved where you can't see it. Revise what you find rather than saving it again.
- Merge duplicates and near-duplicates into one fact: revise_memory one and list the rest in merge, keeping every detail.
- Revise facts the conversation has changed; retire facts that stopped being true. A fact's date helps judge whether it still holds. Old versions are kept as history, so never drop a detail to save space.
- Save lasting facts from the conversation that were never saved, rating their importance: preferences, decisions, things about their lives and plans. Not passing details.
- If nothing needs changing, change nothing.

When you are done, reply with one short line saying what you changed.`

const day = (at: number) => new Date(at).toISOString().slice(0, 10)
const minute = (at: number) => new Date(at).toISOString().slice(0, 16)

/**
 * The messages since `through`, oldest first, keeping the newest that fit in
 * `budget` tokens, and the newest entry among them.
 */
async function newMessages(
  tx: Tx,
  through: EntryId | null,
  budget: number,
  name: string,
) {
  const lines: string[] = []
  let newest: EntryId | undefined
  let tokens = 0
  let cursor: Parameters<Tx['scanEntries']>[2]
  scan: do {
    const page = await tx.scanEntries(
      {
        conversationId: ROOT_CONVERSATION_ID,
        order: 'descending',
        ...(through === null ? {} : { minEntryId: (through + 1) as EntryId }),
      },
      200,
      cursor,
    )
    for (const entry of page.items) {
      const said = saidBy(entry)
      if (!said) continue
      const who = said.who === 'you' ? name : said.who
      const line = `[${minute(said.at)}] ${who}: ${said.text}`
      const size = estimateTextTokens(line)
      if (tokens + size > budget) {
        // A single message larger than the budget is cut, not skipped forever.
        if (!lines.length) lines.push(line.slice(0, budget * 3))
        newest ??= entry.id
        break scan
      }
      newest ??= entry.id
      lines.push(line)
      tokens += size
    }
    cursor = page.next
  } while (cursor)
  return newest === undefined
    ? undefined
    : { newest, transcript: lines.reverse().join('\n') }
}

export type UpkeepOptions = {
  /** The model passes run with. */
  model: ModelRef
  /** What the assistant calls itself, so the pass knows whose replies are whose. */
  name: string
  /** At most this many tokens of conversation go into one pass. */
  transcriptTokens: number
  /** The memory extension passes use: its tools, and recall of facts outside core. */
  extension: Extension
}

/**
 * Daily memory consolidation: at 04:00 a background task gives the messages
 * since the last pass to a separate conversation where the model reviews
 * memory with its own memory tools. Install `extension`, then call `start`
 * once the Harness is open.
 */
export function createUpkeep(options: UpkeepOptions) {
  const sleep = (now: number) =>
    ({
      status: 'sleeping',
      until: nextUpkeep(now),
      checkpoint: { phase: 'pass' },
    }) as const

  const UpkeepTask = defineTask<null, UpkeepStep, null>({
    name: 'familiar.upkeep',
    version: 1,
    initial: () => ({ phase: 'schedule' }),
    phases: {
      schedule: (_task, runtime, context) =>
        runtime.commit(() => sleep(runtime.now()), context),

      pass: (_task, runtime, context) =>
        runtime.commit(async (tx) => {
          const upkeep = await tx.doc(Upkeep)
          const found = await newMessages(
            tx,
            upkeep.through,
            options.transcriptTokens,
            options.name,
          )
          if (!found || upkeep.conversation === null)
            return sleep(runtime.now())

          // The facts the pass sees in its prompt section.
          const facts = coreFacts(await tx.doc(Memory))
          const dates = facts.length
            ? facts.map((fact) => `${fact.id}: ${day(fact.at)}`).join('\n')
            : '(no facts yet)'
          const input = `Recent conversation, oldest first:\n${found.transcript}\n\nWhen each fact was last written:\n${dates}`
          // Passes start from nothing, so the upkeep conversation never grows.
          // Appended directly: nothing else runs there, and the previous pass
          // has settled.
          const reset = await tx.appendEntry(ResetEntry, upkeep.conversation, {
            head: 'self',
          })
          return {
            status: 'running',
            checkpoint: {
              phase: 'consolidate',
              conversation: upkeep.conversation,
              reset: reset.id,
              newest: found.newest,
              input,
            },
          }
        }, context),

      consolidate: async (task, runtime, context) => {
        const { conversation, reset, newest, input } = task.state.checkpoint
        const handle = await runtime.conversation(conversation, context)
        if (!handle) throw new Error(`No upkeep conversation ${conversation}.`)
        // The request ID finds the same submission if a restart reruns this.
        const submission = await handle.submit(
          { type: 'input', content: input, requestId: `upkeep:${reset}` },
          context,
        )
        const settled = await submission.wait(context)
        if (settled.status !== 'done')
          runtime.report(new Error(`Memory upkeep failed: ${settled.reason}`))
        await runtime.commit(async (tx) => {
          // A failed pass leaves these messages for the next one.
          if (settled.status === 'done') (await tx.doc(Upkeep)).through = newest
          return sleep(runtime.now())
        }, context)
      },
    },
    abort: (_task, runtime, context) =>
      runtime.commit(
        () => ({ status: 'terminal', outcome: { status: 'aborted' } }),
        context,
      ),
  })

  return {
    extension: defineExtension({
      name: 'familiar.upkeep',
      tasks: [UpkeepTask],
    }),

    /** Ensures the upkeep conversation and exactly one live upkeep task exist. */
    start: (harness: Harness, context: Context) =>
      harness.commit(async (tx) => {
        const upkeep = await tx.doc(Upkeep)
        // Reads before writes: a transaction cannot read tables after writing.
        const task =
          upkeep.task === null ? undefined : await tx.task(upkeep.task)
        const live =
          task &&
          task.state.status !== 'terminal' &&
          task.state.status !== 'completing'

        if (upkeep.conversation === null)
          upkeep.conversation = (
            await tx.createConversation({ ownership: { kind: 'ownerless' } })
          ).id
        // Every open, so a change of model or wording applies to the next pass.
        await configure(tx, upkeep.conversation, {
          model: options.model,
          extensions: [options.extension],
          instructions: instructions(options.name),
        })
        if (!live)
          // Background, so it never keeps the main conversation busy or is
          // stopped with it.
          upkeep.task = await tx.createTask(UpkeepTask, null, {
            ownership: { kind: 'conversation' },
            conversationId: ROOT_CONVERSATION_ID,
            background: true,
          })
      }, context),
  }
}
