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
import { saidBy } from '../../conversation/message.ts'
import { Rooms } from '../../rooms/rooms.ts'
import { entriesOf } from '../../pi/entries.ts'
import { addDays, hourOn, localDay } from '../../time.ts'
import {
  familiarDoc,
  familiarRecord,
  type FamiliarId,
  type FamiliarRecord,
} from '../../workspace/familiars.ts'
import { People } from '../../workspace/people.ts'
import {
  isCurrent,
  keyOf,
  LIMITS,
  Memory,
  memoryOf,
  openMonth,
  Pages,
  SELF,
  type PageState,
} from '../store.ts'
import { applyFiling, type Dropped, type FilingStore } from './apply.ts'
import {
  meetPeople,
  nextBatch,
  renderBatch,
  SETTLE_MS,
  touched,
  type BatchMessage,
} from './batch.ts'
import { applyTidy, renderPage, repairPage, TIDY_LIMIT } from './consolidate.ts'
import { filingInstructions, tidyInstructions } from './prompts.ts'
import { fileTool, tidyTool, type FileArgs, type TidyArgs } from './tools.ts'

/**
 * Memory's background work, per Familiar. A clock wakes every hour and, if
 * there is anything to do, starts a pass; `remember` starts one at once.
 * Only one pass runs at a time. A pass files the settled person messages in
 * batches until it has caught up, then, once a night, consolidates: repairs
 * every page by rule and has the memory model tidy each page that changed.
 * An hour with nothing new costs nothing.
 */

const HOUR = 60 * 60 * 1000

/** Consolidation runs on the first pass after this hour, in Familiar's zone. */
const NIGHT_HOUR = 4

/** A batch whose call fails this many times in a row is skipped and reported. */
const ATTEMPTS = 3

/** How many of the operations filing dropped are kept to look at. */
const DROPPED_KEPT = 30

/**
 * The night a time belongs to: nights run from 04:00 to 04:00 on the wall
 * clock, so a chat at 1am counts with the evening before, as people think
 * of it, and consolidation runs once per night.
 */
export function nightOf(at: number, timeZone: string) {
  const day = localDay(at, timeZone)
  return at < hourOn(day, NIGHT_HOUR, timeZone) ? addDays(day, -1) : day
}

/** When the next night's consolidation is due after `now`. */
export function nextNight(now: number, timeZone: string) {
  const today = localDay(now, timeZone)
  const next = hourOn(today, NIGHT_HOUR, timeZone)
  return next > now ? next : hourOn(addDays(today, 1), NIGHT_HOUR, timeZone)
}

/** The clock's next tick after `now`: the next whole hour. */
export const nextTick = (now: number) => (Math.floor(now / HOUR) + 1) * HOUR

export type FilingState = {
  /** The clock task, which sleeps between ticks. */
  clock: TaskId | null
  /** The pass running now, if any: there is never more than one. */
  pass: TaskId | null
  /** The newest chat entry filed: filing's progress mark. */
  through: EntryId | null
  /** Failed calls in a row on the batch after `through`. */
  failures: number
  /** Unfiled messages someone asked to have remembered: filed as soon as they're said. */
  asked: EntryId[]
  /** The night (`nightOf`) last consolidated. */
  consolidated: string | null
  /** The latest operations filing dropped, oldest first, for inspection. */
  dropped: (Dropped & { at: number })[]
}

/** Where a Familiar's filing has got to. */
export const Filing = defineDocFamily<FilingState, null>({
  kind: 'familiar.filing',
  version: 1,
  scope: 'session',
  family: true,
  initial: () => ({
    clock: null,
    pass: null,
    through: null,
    failures: 0,
    asked: [],
    consolidated: null,
    dropped: [],
  }),
  checkpointWhen: () => true, // small: always store it whole
})

/** The extensions memory's calls run with; no other conversation gets them. */
export const FILING_EXTENSION = 'familiar.filing'
export const TIDY_EXTENSION = 'familiar.tidy'

type PassInput = { familiar: FamiliarId }

type Call = { conversation: ConversationId; reset: EntryId; input: string }

type PassStep =
  | { phase: 'select' }
  | ({
      phase: 'file'
      messages: BatchMessage[]
      through: EntryId
      pages: string[]
    } & Call)
  | { phase: 'repair' }
  | { phase: 'tidy'; queue: string[] }
  | ({ phase: 'tidying'; subject: string; queue: string[] } & Call)

type ClockStep = { phase: 'tick' }

export type FilingOptions = {
  /** What memory's calls run on unless the Familiar's record picks another. */
  memoryModel: ModelChoice
  /** The models a Familiar's record may pick, each at its level. */
  modelChoices: readonly ModelChoice[]
  /** The IANA zone that sets the nights and dates what was said. */
  timeZone: string
}

const isLive = (status: string | undefined) =>
  status !== undefined && status !== 'terminal' && status !== 'completing'

/**
 * Whether a settled person message, or one asked to be remembered, waits
 * after `through`. Reads only the entries since the last pass.
 */
async function unfiled(
  tx: Tx,
  familiar: FamiliarId,
  { through, asked }: Pick<FilingState, 'through' | 'asked'>,
  now: number,
) {
  for await (const entry of entriesOf(tx, {
    conversationId: familiar,
    order: 'ascending',
    ...(through !== null && { minEntryId: (through + 1) as EntryId }),
  })) {
    const said = saidBy(entry)
    if (said?.role === 'person') {
      return said.at <= now - SETTLE_MS || asked.length > 0
    }
  }
  return false
}

export function createFiling(options: FilingOptions) {
  const { timeZone } = options

  /** Pages' documents, read and written in one commit. */
  const storeOf = (
    tx: Tx,
    familiar: FamiliarId,
    memory: Awaited<ReturnType<typeof memoryOf>>,
  ): FilingStore => ({
    memory,
    page: (subject) => tx.doc(Pages, keyOf(familiar, subject), null),
    month: (month) => openMonth(tx, familiar, memory, month),
  })

  /**
   * Sets up a Familiar's memory conversation for one call and starts it
   * from nothing, so it never grows and no call sees another's. A record's
   * model that is no longer a choice falls back to the workspace's. Calls
   * run one at a time, in a pass, so the reset is appended directly.
   */
  const startCall = async (
    tx: Tx,
    record: FamiliarRecord,
    instructions: string,
    extension: Extension,
    input: string,
  ): Promise<Call> => {
    const { model, thinkingLevel } =
      findModelChoice(options.modelChoices, record.memoryModel) ??
      options.memoryModel
    await configure(tx, record.upkeep, {
      model,
      thinkingLevel,
      extensions: [extension],
      instructions,
    })
    const reset = await tx.appendEntry(ResetEntry, record.upkeep, {
      head: 'self',
    })
    return { conversation: record.upkeep, reset: reset.id, input }
  }

  /**
   * Submits a call's input and returns the arguments of its `tool` call, or
   * undefined after reporting why there are none. `requestId` finds the same
   * submission if a restart reruns the phase.
   */
  const ask = async <T>(
    runtime: TaskRuntime<PassInput, PassStep, null, object>,
    { conversation, reset, input }: Call,
    tool: string,
    context: Context,
  ): Promise<T | undefined> => {
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
      runtime.report(
        new Error(`Memory's ${tool} call failed: ${settled.reason}`),
      )
      return undefined
    }
    // A task commit returns its next state, not values, so read into this.
    let content: unknown
    await runtime.commit(async (tx) => {
      // An input that was answered always has its answer's entry; it is in
      // memory's conversation, not the task's, so it is read through a commit.
      content = (await tx.entry(AssistantEntry, settled.answer!))?.model?.[0]
        ?.content
    }, context)
    const call = Array.isArray(content)
      ? (
          content as { type: string; name?: string; arguments?: unknown }[]
        ).find((part) => part.type === 'toolCall' && part.name === tool)
      : undefined
    if (!call) {
      runtime.report(
        new Error(`Memory's ${tool} call answered without calling ${tool}.`),
      )
      return undefined
    }
    return call.arguments as T
  }

  /** Ends a pass, leaving the next one to the clock or `remember`. */
  const finish = async (tx: Tx, familiar: FamiliarId) => {
    ;(await familiarDoc(tx, Filing, familiar)).pass = null
    return {
      status: 'terminal',
      outcome: { status: 'completed', result: null },
    } as const
  }

  const next = (step: PassStep) =>
    ({ status: 'running', checkpoint: step }) as const

  const PassTask = defineTask<PassInput, PassStep, null>({
    name: 'familiar.memory-pass',
    version: 1,
    initial: () => ({ phase: 'select' }),
    phases: {
      select: (task, runtime, context) =>
        runtime.commit(async (tx) => {
          const { familiar } = task.input
          const now = runtime.now()
          const filing = await familiarDoc(tx, Filing, familiar)
          const people = await tx.doc(People)
          // Table reads before any write.
          const selected = await nextBatch(tx, familiar, filing, {
            now,
            timeZone,
            people,
          })
          const record = await familiarRecord(tx, familiar)
          const memory = await memoryOf(tx, familiar, record.name)
          // Its own page is named for it, through renames, and so are
          // people's; people get theirs before the call that first shows them.
          if (memory.subjects[0].name !== record.name) {
            memory.subjects[0].name = record.name
          }
          meetPeople(memory, people, selected.messages, now)

          if (!selected.messages.length) {
            if (selected.end !== undefined) {
              filing.through = selected.end
            }
            return filing.consolidated === nightOf(now, timeZone)
              ? finish(tx, familiar)
              : next({ phase: 'repair' })
          }

          const pages = new Map<string, PageState>()
          for (const subject of touched(memory, selected.messages)) {
            pages.set(
              subject,
              JSON.parse(
                JSON.stringify(
                  await tx.doc(Pages, keyOf(familiar, subject), null),
                ),
              ) as PageState,
            )
          }
          const input = renderBatch(
            selected,
            memory,
            pages,
            await tx.doc(Rooms),
            record.name,
            timeZone,
          )
          return next({
            phase: 'file',
            messages: selected.messages,
            through: selected.end!,
            pages: [...pages.keys()],
            ...(await startCall(
              tx,
              record,
              filingInstructions(record.name),
              filingExtension,
              input,
            )),
          })
        }, context),

      file: async (task, runtime, context) => {
        const step = task.state.checkpoint
        const args = await ask<FileArgs>(runtime, step, 'file', context)
        await runtime.commit(async (tx) => {
          const { familiar } = task.input
          const filing = await familiarDoc(tx, Filing, familiar)
          if (!args) {
            filing.failures++
            if (filing.failures < ATTEMPTS) {
              // The next tick tries this batch again.
              return finish(tx, familiar)
            }
            runtime.report(
              new Error(
                `Memory skipped messages ${step.messages[0].entry} to ${step.through}: filing failed ${ATTEMPTS} times.`,
              ),
            )
          } else {
            const record = await familiarRecord(tx, familiar)
            const memory = await memoryOf(tx, familiar, record.name)
            const now = runtime.now()
            const { dropped } = await applyFiling(
              storeOf(tx, familiar, memory),
              step.messages,
              step.pages,
              args,
              { now, timeZone },
            )
            if (dropped.length) {
              filing.dropped = [
                ...filing.dropped,
                ...dropped.map((each) => ({ ...each, at: now })),
              ].slice(-DROPPED_KEPT)
            }
          }
          // The operations and the mark, in one commit.
          filing.through = step.through
          filing.failures = 0
          filing.asked = filing.asked.filter((entry) => entry > step.through)
          return next({ phase: 'select' })
        }, context)
      },

      repair: async (task, runtime, context) => {
        const { familiar } = task.input
        // Read from snapshots, so only pages that need a repair are opened.
        const memory = await runtime.snapshot(Memory, String(familiar), context)
        const now = runtime.now()
        const today = localDay(now, timeZone)
        const due: string[] = []
        for (const subject of memory?.subjects ?? []) {
          const page = await runtime.snapshot(
            Pages,
            keyOf(familiar, subject.id),
            context,
          )
          if (
            page &&
            repairPage(structuredClone(page) as PageState, today, now)
          ) {
            due.push(subject.id)
          }
        }
        await runtime.commit(async (tx) => {
          const record = await familiarRecord(tx, familiar)
          const memory = await memoryOf(tx, familiar, record.name)
          for (const id of due) {
            const page = await tx.doc(Pages, keyOf(familiar, id), null)
            const subject = memory.subjects.find((subject) => subject.id === id)
            if (subject && repairPage(page, today, now)) {
              subject.changed = now
            }
          }
          const queue = memory.subjects
            .filter((subject) => subject.changed > (subject.tidied ?? -1))
            .sort((a, b) => a.changed - b.changed)
            .slice(0, TIDY_LIMIT)
            .map((subject) => subject.id)
          return next({ phase: 'tidy', queue })
        }, context)
      },

      tidy: (task, runtime, context) =>
        runtime.commit(async (tx) => {
          const { familiar } = task.input
          const [head, ...queue] = task.state.checkpoint.queue
          if (head === undefined) {
            ;(await familiarDoc(tx, Filing, familiar)).consolidated = nightOf(
              runtime.now(),
              timeZone,
            )
            return finish(tx, familiar)
          }
          const record = await familiarRecord(tx, familiar)
          const memory = await memoryOf(tx, familiar, record.name)
          const subject = memory.subjects.find((each) => each.id === head)
          if (!subject) {
            return next({ phase: 'tidy', queue })
          }
          const page = await tx.doc(Pages, keyOf(familiar, head), null)
          // Nothing current to write a profile from: no call needed.
          if (!page.notes.some(isCurrent)) {
            page.profile = ''
            subject.tidied = subject.changed
            return next({ phase: 'tidy', queue })
          }
          return next({
            phase: 'tidying',
            subject: head,
            queue,
            ...(await startCall(
              tx,
              record,
              tidyInstructions(
                record.name,
                subject.id === SELF ? `itself (${record.name})` : subject.name,
                LIMITS.profile,
              ),
              tidyExtension,
              renderPage(subject, page, await tx.doc(Rooms)),
            )),
          })
        }, context),

      tidying: async (task, runtime, context) => {
        const step = task.state.checkpoint
        const args = await ask<TidyArgs>(runtime, step, 'tidy', context)
        await runtime.commit(async (tx) => {
          const { familiar } = task.input
          const record = await familiarRecord(tx, familiar)
          const memory = await memoryOf(tx, familiar, record.name)
          const subject = memory.subjects.find(
            (each) => each.id === step.subject,
          )
          // A failed call leaves the page due, for the next night.
          if (args && subject) {
            applyTidy(
              subject,
              await tx.doc(Pages, keyOf(familiar, subject.id), null),
              args,
              runtime.now(),
            )
            subject.tidied = subject.changed
          }
          return next({ phase: 'tidy', queue: step.queue })
        }, context)
      },
    },
    abort: (task, runtime, context) =>
      runtime.commit((tx) => finish(tx, task.input.familiar), context),
  })

  /**
   * Starts a pass for `familiar` unless one is running. A table read, then
   * a write, so call it before the commit writes any table.
   */
  const startPass = async (tx: Tx, familiar: FamiliarId) => {
    const filing = await familiarDoc(tx, Filing, familiar)
    const running =
      filing.pass === null ? undefined : await tx.task(filing.pass)
    if (isLive(running?.state.status)) {
      return
    }
    // Background, so it never keeps the chat busy or is stopped with it.
    filing.pass = await tx.createTask(
      PassTask,
      { familiar },
      {
        ownership: { kind: 'conversation' },
        conversationId: familiar,
        background: true,
      },
    )
  }

  const ClockTask = defineTask<PassInput, ClockStep, null>({
    name: 'familiar.memory-clock',
    version: 1,
    initial: () => ({ phase: 'tick' }),
    phases: {
      tick: (task, runtime, context) =>
        runtime.commit(async (tx) => {
          const { familiar } = task.input
          const now = runtime.now()
          const filing = await familiarDoc(tx, Filing, familiar)
          if (
            (await unfiled(tx, familiar, filing, now)) ||
            filing.consolidated !== nightOf(now, timeZone)
          ) {
            await startPass(tx, familiar)
          }
          return {
            status: 'sleeping',
            until: nextTick(now),
            checkpoint: { phase: 'tick' },
          }
        }, context),
    },
    abort: (_task, runtime, context) =>
      runtime.commit(
        () => ({ status: 'terminal', outcome: { status: 'aborted' } }),
        context,
      ),
  })

  const filingExtension: Extension = defineExtension({
    name: FILING_EXTENSION,
    tasks: [ClockTask, PassTask],
    tools: [fileTool],
  })
  const tidyExtension: Extension = defineExtension({
    name: TIDY_EXTENSION,
    tools: [tidyTool],
  })

  return {
    extensions: [filingExtension, tidyExtension],
    startPass,

    /** Ensures `familiar`'s one clock is running. */
    start: (tx: Tx, familiar: FamiliarId) =>
      (async () => {
        const filing = await familiarDoc(tx, Filing, familiar)
        const clock =
          filing.clock === null ? undefined : await tx.task(filing.clock)
        if (!isLive(clock?.state.status)) {
          filing.clock = await tx.createTask(
            ClockTask,
            { familiar },
            {
              ownership: { kind: 'conversation' },
              conversationId: familiar,
              background: true,
            },
          )
        }
      })(),
  }
}

export type FilingApi = ReturnType<typeof createFiling>
