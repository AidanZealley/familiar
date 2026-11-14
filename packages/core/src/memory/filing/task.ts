import type { Context } from '@earendil-works/chord'
import {
  AssistantEntry,
  configure,
  defineDocFamily,
  defineExtension,
  defineTask,
  ResetEntry,
  type ConversationId,
  type EntryId,
  type Extension,
  type TaskId,
  type TaskRuntime,
  type Tx,
} from '@earendil-works/pi-durable'
import { findModelChoice, type ModelChoice } from '../../conversation/models.ts'
import { Rooms } from '../../rooms/rooms.ts'
import { Schedules } from '../../schedules/schedules.ts'
import { addDays, hourOn, localDay } from '../../time.ts'
import {
  familiarDoc,
  familiarRecord,
  type FamiliarId,
  type FamiliarRecord,
} from '../../workspace/familiars.ts'
import { People } from '../../workspace/people.ts'
import {
  clipText,
  Journal,
  keyOf,
  LIMITS,
  Memory,
  Pages,
  type MemoryState,
  type PageState,
} from '../store.ts'
import { applyFiling, fileTool, type FileArgs } from './apply.ts'
import {
  meetPeople,
  nextBatch,
  renderBatch,
  touched,
  type BatchMessage,
} from './batch.ts'
import { filingInstructions, profileInstructions } from './prompts.ts'

/**
 * Memory's background work: one task per Familiar that sleeps until
 * NIGHT_HOUR, files every unfiled person message in batches, one call each,
 * writes the profile of each page whose notes changed, one call each, and
 * sleeps again. A night with nothing new costs nothing. A failed call ends
 * the night where it is, and the next night carries on from there.
 */

/** Memory's work runs at this hour, in Familiar's zone. */
const NIGHT_HOUR = 4

/** When the next night's work is due after `now`. */
export function nextNight(now: number, timeZone: string) {
  const today = localDay(now, timeZone)
  const next = hourOn(today, NIGHT_HOUR, timeZone)
  return next > now ? next : hourOn(addDays(today, 1), NIGHT_HOUR, timeZone)
}

export type FilingState = {
  /** The task, which sleeps between nights. */
  task: TaskId | null
  /** The newest chat entry filed: filing's progress mark. */
  through: EntryId | null
}

export const Filing = defineDocFamily<FilingState, null>({
  kind: 'familiar.filing',
  version: 1,
  scope: 'session',
  family: true,
  initial: () => ({ task: null, through: null }),
  checkpointWhen: () => true, // small: always store it whole
})

/** The extension memory's calls run with; no other conversation gets it. */
export const FILING_EXTENSION = 'familiar.filing'

type Input = { familiar: FamiliarId }

type Call = { conversation: ConversationId; reset: EntryId; input: string }

type Step =
  | { phase: 'sleep' }
  | { phase: 'select' }
  | ({
      phase: 'file'
      messages: BatchMessage[]
      through: EntryId
      pages: string[]
    } & Call)
  | { phase: 'profile' }
  | ({ phase: 'profiling'; subject: string; changed: number } & Call)

export type FilingOptions = {
  /** What memory's calls run on unless the Familiar's record picks another. */
  memoryModel: ModelChoice
  /** The models a Familiar's record may pick, each at its level. */
  modelChoices: readonly ModelChoice[]
  /** The IANA zone that sets the nights and dates what was said. */
  timeZone: string
}

/** The first subject whose notes changed since its profile was written. */
const dueProfile = (memory: MemoryState) =>
  memory.subjects.find((subject) => subject.changed !== subject.profiled)

export function createFiling(options: FilingOptions) {
  const { timeZone } = options

  /**
   * Sets up the Familiar's memory conversation for one call, from nothing,
   * so no call sees another's. A record's model that is no longer a choice
   * falls back to the workspace's.
   */
  const startCall = async (
    tx: Tx,
    record: FamiliarRecord,
    instructions: string,
    withFile: boolean,
    input: string,
  ): Promise<Call> => {
    const { model, thinkingLevel } =
      findModelChoice(options.modelChoices, record.memoryModel) ??
      options.memoryModel
    await configure(tx, record.upkeep, {
      model,
      thinkingLevel,
      extensions: withFile ? [filingExtension] : [],
      instructions,
    })
    const reset = await tx.appendEntry(ResetEntry, record.upkeep, {
      head: 'self',
    })
    return { conversation: record.upkeep, reset: reset.id, input }
  }

  /**
   * Submits a call's input and returns its answer's content, or undefined
   * after reporting why there is none. `requestId` finds the same submission
   * if a restart reruns the phase.
   */
  const ask = async (
    runtime: TaskRuntime<Input, Step, null, object>,
    { conversation, reset, input }: Call,
    context: Context,
  ) => {
    const handle = await runtime.conversation(conversation, context)
    if (!handle) {
      throw new Error(`No memory conversation ${conversation}.`)
    }
    const submission = await handle.submit(
      { type: 'input', content: input, requestId: `memory:${reset}` },
      context,
    )
    const settled = await submission.wait(context)
    if (settled.status !== 'done') {
      runtime.report(new Error(`Memory's call failed: ${settled.reason}`))
      return undefined
    }
    let content: unknown
    await runtime.commit(async (tx) => {
      content = (await tx.entry(AssistantEntry, settled.answer!))?.model?.[0]
        ?.content
    }, context)
    return Array.isArray(content)
      ? (content as {
          type: string
          name?: string
          text?: string
          arguments?: unknown
        }[])
      : undefined
  }

  const next = (step: Step) =>
    ({ status: 'running', checkpoint: step }) as const

  const NightTask = defineTask<Input, Step, null>({
    name: 'familiar.memory',
    version: 1,
    initial: () => ({ phase: 'sleep' }),
    phases: {
      sleep: (_task, runtime, context) =>
        runtime.commit(
          () => ({
            status: 'sleeping',
            until: nextNight(runtime.now(), timeZone),
            checkpoint: { phase: 'select' },
          }),
          context,
        ),

      select: (task, runtime, context) =>
        runtime.commit(async (tx) => {
          const { familiar } = task.input
          const filing = await familiarDoc(tx, Filing, familiar)
          const people = await tx.doc(People)
          const selected = await nextBatch(tx, familiar, filing.through, people)
          const record = await familiarRecord(tx, familiar)
          const memory = await tx.doc(Memory, String(familiar), null)
          meetPeople(memory, people, selected.messages, runtime.now())
          if (!selected.messages.length) {
            if (selected.end !== undefined) {
              filing.through = selected.end
            }
            return next({ phase: 'profile' })
          }
          const pages = new Map<string, PageState>()
          for (const subject of touched(memory, selected.messages)) {
            pages.set(
              subject,
              await tx.doc(Pages, keyOf(familiar, subject), null),
            )
          }
          const input = renderBatch(selected, memory, pages, {
            rooms: await tx.doc(Rooms),
            schedules: await familiarDoc(tx, Schedules, familiar),
            name: record.name,
            timeZone,
          })
          return next({
            phase: 'file',
            messages: selected.messages,
            through: selected.end!,
            pages: [...pages.keys()],
            ...(await startCall(
              tx,
              record,
              filingInstructions(record.name),
              true,
              input,
            )),
          })
        }, context),

      file: async (task, runtime, context) => {
        const step = task.state.checkpoint
        const content = await ask(runtime, step, context)
        const call = content?.find(
          (part) => part.type === 'toolCall' && part.name === 'file',
        )
        await runtime.commit(async (tx) => {
          const { familiar } = task.input
          if (!call) {
            if (content) {
              runtime.report(new Error('Filing answered without calling file.'))
            }
            return next({ phase: 'sleep' })
          }
          const memory = await tx.doc(Memory, String(familiar), null)
          await applyFiling(
            {
              memory,
              page: (subject) => tx.doc(Pages, keyOf(familiar, subject), null),
              month: (month) => {
                if (!memory.months.includes(month)) {
                  memory.months = [...memory.months, month].sort()
                }
                return tx.doc(Journal, keyOf(familiar, month), null)
              },
            },
            step.messages,
            step.pages,
            call.arguments as FileArgs,
            { now: runtime.now(), timeZone },
          )
          // What was filed and the mark, in one commit.
          ;(await familiarDoc(tx, Filing, familiar)).through = step.through
          return next({ phase: 'select' })
        }, context)
      },

      profile: (task, runtime, context) =>
        runtime.commit(async (tx) => {
          const { familiar } = task.input
          const memory = await tx.doc(Memory, String(familiar), null)
          const subject = dueProfile(memory)
          if (!subject) {
            return next({ phase: 'sleep' })
          }
          const page = await tx.doc(Pages, keyOf(familiar, subject.id), null)
          if (!page.notes.length) {
            page.profile = ''
            subject.profiled = subject.changed
            return next({ phase: 'profile' })
          }
          const record = await familiarRecord(tx, familiar)
          const notes = page.notes
            .map(
              (note) =>
                `${note.since}, said by ${note.saidBy.name}: ${note.text}`,
            )
            .join('\n')
          return next({
            phase: 'profiling',
            subject: subject.id,
            changed: subject.changed,
            ...(await startCall(
              tx,
              record,
              profileInstructions(record.name, subject.name, LIMITS.profile),
              false,
              `Notes about ${subject.name}, oldest first:\n${notes}`,
            )),
          })
        }, context),

      profiling: async (task, runtime, context) => {
        const step = task.state.checkpoint
        const text = (await ask(runtime, step, context))
          ?.flatMap((part) => (part.type === 'text' ? [part.text ?? ''] : []))
          .join('')
          .trim()
        await runtime.commit(async (tx) => {
          const { familiar } = task.input
          if (!text) {
            return next({ phase: 'sleep' })
          }
          const memory = await tx.doc(Memory, String(familiar), null)
          const subject = memory.subjects.find(
            (each) => each.id === step.subject,
          )
          if (subject) {
            const page = await tx.doc(Pages, keyOf(familiar, subject.id), null)
            page.profile = clipText(text, LIMITS.profile)
            subject.profiled = step.changed
          }
          return next({ phase: 'profile' })
        }, context)
      },
    },
    abort: (_task, runtime, context) =>
      runtime.commit(
        () => ({ status: 'terminal', outcome: { status: 'aborted' } }),
        context,
      ),
  })

  const filingExtension: Extension = defineExtension({
    name: FILING_EXTENSION,
    tasks: [NightTask],
    tools: [fileTool],
  })

  return {
    extension: filingExtension,

    /** Ensures `familiar`'s one task is running. */
    start: async (tx: Tx, familiar: FamiliarId) => {
      const filing = await familiarDoc(tx, Filing, familiar)
      const task = filing.task === null ? undefined : await tx.task(filing.task)
      if (!task || task.state.status === 'terminal') {
        // Background, so it never keeps the chat busy or is stopped with it.
        filing.task = await tx.createTask(
          NightTask,
          { familiar },
          {
            ownership: { kind: 'conversation' },
            conversationId: familiar,
            background: true,
          },
        )
      }
    },
  }
}
