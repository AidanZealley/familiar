import type { Context } from '@earendil-works/chord'
import {
  AssistantEntry,
  configure,
  defineExtension,
  defineTask,
  ResetEntry,
  type Extension,
  type ConversationId,
  type EntryId,
  type EntryRecord,
  type Harness,
  type TaskRuntime,
  type Tx,
} from '@earendil-works/pi-durable'
import { findModelChoice, type ModelChoice } from '../../conversation/models.ts'
import { saidBy } from '../../conversation/message.ts'
import {
  addEpisode,
  dueRollup,
  Episodes,
  type EpisodesState,
} from '../episodes.ts'
import { describeEpisode } from '../recall.ts'
import { addDays } from '../../time.ts'
import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import {
  coreFacts,
  dueForReview,
  factDays,
  Facts,
  markChecked,
  MemoryUsage,
  openMemory,
  rebalanceCore,
} from '../facts.ts'
import { instructions, rollupInstructions } from './prompts.ts'
import { nextUpkeep, Upkeep, upkeepDay } from './schedule.ts'
import { upkeepTools } from './tools.ts'
import { newMessages } from './transcript.ts'
import {
  familiarDoc,
  familiarRecord,
  type FamiliarId,
  type FamiliarRecord,
} from '../../workspace/familiars.ts'

/** The Familiar whose memory a task keeps. */
type UpkeepInput = { familiar: FamiliarId }

type UpkeepStep =
  | { phase: 'schedule' }
  /** Selects the next batch, on waking at 04:00 or after a completed batch. */
  | { phase: 'pass' }
  /** Built in `pass`, so a rerun after a restart submits the same input. */
  | {
      phase: 'consolidate'
      conversation: ConversationId
      reset: EntryId
      /** The batch's first and last entries. */
      oldest: EntryId
      newest: EntryId
      input: string
      /** The day the messages belong to, for the day's episode. */
      day: string
    }
  /** Rolls up the next finished week or month, if any, else sleeps. */
  | { phase: 'rollup' }
  | {
      phase: 'summarize'
      conversation: ConversationId
      reset: EntryId
      span: 'week' | 'month'
      start: string
      end: string
      input: string
    }
  /** Once rollups are done, picks the facts due for a recheck, else sleeps. */
  | { phase: 'review' }
  | {
      phase: 'recheck'
      conversation: ConversationId
      reset: EntryId
      /** The facts the review was given, stamped checked when it succeeds. */
      facts: string[]
      input: string
    }

/** Upkeep's extension, which holds the tools that write facts. */
export const UPKEEP_EXTENSION = 'familiar.upkeep'

export type UpkeepOptions = {
  /** What upkeep runs on unless the Familiar's record picks another. */
  memoryModel: ModelChoice
  /** The models a Familiar's record may pick, each at its level. */
  modelChoices: readonly ModelChoice[]
  transcriptTokens: number
  /** The IANA zone that sets upkeep's 04:00 and the days it files. */
  timeZone: string
  extension: Extension
}

/** The review sees the day episodes of this many days. */
const REVIEW_DAYS = 30

/**
 * The day episodes of the last REVIEW_DAYS before `today`, newest kept first
 * when they pass `budget`, shown oldest first.
 */
function recentDays(episodes: EpisodesState, today: string, budget: number) {
  const since = addDays(today, -REVIEW_DAYS)
  const lines: string[] = []
  let tokens = 0
  for (const day of episodes.episodes
    .filter((episode) => episode.span === 'day' && episode.end >= since)
    .sort((a, b) => b.end.localeCompare(a.end))) {
    const line = describeEpisode(day)
    tokens += estimateTextTokens(line)
    if (tokens > budget) {
      break
    }
    lines.unshift(line)
  }
  return lines.join('\n\n')
}

/**
 * Daily memory upkeep: at 04:00 a background task files unreviewed messages
 * in bounded, oldest-first day batches in a separate conversation with the
 * writing tools, rolls up finished weeks and months, then rechecks the facts
 * that have gone longest without a check. Each stage is bounded, so a
 * night's work never grows with the size of memory. Install `extension`,
 * then call `start` once the Harness is open.
 */
export function createUpkeep(options: UpkeepOptions) {
  const sleep = (now: number) =>
    ({
      status: 'sleeping',
      until: nextUpkeep(now, options.timeZone),
      checkpoint: { phase: 'pass' },
    }) as const

  /**
   * Submits `input` to an upkeep conversation and returns the reply, or
   * undefined after reporting a failure. `requestId` finds the same
   * submission if a restart reruns the phase.
   */
  const ask = async (
    runtime: TaskRuntime<UpkeepInput, UpkeepStep, null, object>,
    conversation: ConversationId,
    requestId: string,
    input: string,
    context: Context,
  ) => {
    const handle = await runtime.conversation(conversation, context)
    if (!handle) {
      throw new Error(`No upkeep conversation ${conversation}.`)
    }
    const submission = await handle.submit(
      { type: 'input', content: input, requestId },
      context,
    )
    const settled = await submission.wait(context)
    if (settled.status !== 'done') {
      runtime.report(new Error(`Memory upkeep failed: ${settled.reason}`))
      return undefined
    }
    // A task commit returns its next state, not values, so read into this.
    let answer: EntryRecord | undefined
    await runtime.commit(async (tx) => {
      // An input that was answered always has its answer's entry.
      answer = await tx.entry(AssistantEntry, settled.answer!)
    }, context)
    return (answer && saidBy(answer)?.text.trim()) ?? ''
  }

  /**
   * Sets up a Familiar's upkeep conversation for a pass's job and starts it
   * from nothing, so it never grows and no job sees another's. Set up at each
   * pass, so a change of model, name or wording applies to the next. A
   * record's model that is no longer a choice falls back to the workspace's. Passes
   * run one at a time, in this task. The reset is appended directly: nothing
   * else runs there, and the last pass settled.
   */
  const startPass = async (
    tx: Tx,
    record: FamiliarRecord,
    job: 'filing' | 'rollup',
  ) => {
    const conversation = record.upkeep
    const { model, thinkingLevel } =
      findModelChoice(options.modelChoices, record.memoryModel) ??
      options.memoryModel
    await configure(tx, conversation, {
      model,
      thinkingLevel,
      // Rollups summarise, with no tools, so they can't change facts.
      ...(job === 'filing'
        ? {
            extensions: [options.extension, extension],
            instructions: instructions(record.name),
          }
        : { extensions: [], instructions: rollupInstructions(record.name) }),
    })
    const reset = await tx.appendEntry(ResetEntry, conversation, {
      head: 'self',
    })
    return { conversation, reset: reset.id }
  }

  /** Once the backlog is clear, write any rollups that are due. */
  const rollup = { status: 'running', checkpoint: { phase: 'rollup' } } as const

  /** Once rollups are written, recheck the facts that are due. */
  const review = { status: 'running', checkpoint: { phase: 'review' } } as const

  const UpkeepTask = defineTask<UpkeepInput, UpkeepStep, null>({
    name: 'familiar.upkeep',
    // Stored tasks are at 2; a lower version would need a migration.
    version: 2,
    initial: () => ({ phase: 'schedule' }),
    phases: {
      schedule: (_task, runtime, context) =>
        runtime.commit(() => sleep(runtime.now()), context),

      pass: (task, runtime, context) =>
        runtime.commit(async (tx) => {
          const { familiar } = task.input
          const record = await familiarRecord(tx, familiar)
          const upkeep = await familiarDoc(tx, Upkeep, familiar)
          const found = await newMessages(
            tx,
            familiar,
            upkeep.through,
            options.transcriptTokens,
            record.name,
            options.timeZone,
          )
          // Rollups wait until every pending batch has been reviewed.
          if (!found) {
            return rollup
          }

          if (found.truncated) {
            runtime.report(
              new Error(
                `Memory upkeep truncated oversized message ${found.newest}.`,
              ),
            )
          }

          // The facts the pass sees in its prompt section.
          const facts = coreFacts(await familiarDoc(tx, Facts, familiar))
          const dates = facts.length
            ? facts.map((fact) => `${fact.id}: since ${fact.since}`).join('\n')
            : '(no facts yet)'
          const input = `Recent conversation, oldest first:\n${found.transcript}\n\nWhen each fact became true:\n${dates}`
          return {
            status: 'running',
            checkpoint: {
              phase: 'consolidate',
              ...(await startPass(tx, record, 'filing')),
              oldest: found.oldest,
              newest: found.newest,
              input,
              day: found.day,
            },
          }
        }, context),

      consolidate: async (task, runtime, context) => {
        const { conversation, reset, oldest, newest, input, day } =
          task.state.checkpoint
        let episode = await ask(
          runtime,
          conversation,
          `upkeep:${reset}`,
          input,
          context,
        )

        // The review may end with its edits and no episode. Ask once more in
        // the same conversation, so the edits stand and aren't made twice.
        if (episode === '') {
          episode = await ask(
            runtime,
            conversation,
            `upkeep:${reset}:episode`,
            'Now reply with only the episode for that conversation.',
            context,
          )
        }

        await runtime.commit(async (tx) => {
          // A failed pass (the model couldn't be reached) leaves these
          // messages for the next one.
          if (episode === undefined) {
            return sleep(runtime.now())
          }

          // Still nothing: report the missing episode and move on rather
          // than review the same batch again every night.
          if (!episode) {
            runtime.report(new Error('Memory upkeep wrote no episode.'))
          }

          const { familiar } = task.input
          const upkeep = await familiarDoc(tx, Upkeep, familiar)
          upkeep.through = newest

          if (episode) {
            addEpisode(await familiarDoc(tx, Episodes, familiar), {
              span: 'day',
              start: day,
              end: day,
              text: episode,
              at: runtime.now(),
              entries: { from: oldest, to: newest },
            })
          }

          rebalanceCore(await openMemory(tx, familiar))
          return { status: 'running', checkpoint: { phase: 'pass' } } as const
        }, context)
      },

      rollup: (task, runtime, context) =>
        runtime.commit(async (tx) => {
          const { familiar } = task.input
          const record = await familiarRecord(tx, familiar)
          const due = dueRollup(
            await familiarDoc(tx, Episodes, familiar),
            upkeepDay(runtime.now(), options.timeZone),
          )
          if (!due) {
            return review
          }
          const days = due.days
            .map(
              (day) =>
                `${day.start === day.end ? day.start : `${day.start} to ${day.end}`}: ${day.text}`,
            )
            .join('\n\n')
          const input = `The ${due.span} of ${due.start} to ${due.end}:\n\n${days}`
          return {
            status: 'running',
            checkpoint: {
              phase: 'summarize',
              ...(await startPass(tx, record, 'rollup')),
              span: due.span,
              start: due.start,
              end: due.end,
              input,
            },
          }
        }, context),

      summarize: async (task, runtime, context) => {
        const { conversation, reset, span, start, end, input } =
          task.state.checkpoint
        const episode = await ask(
          runtime,
          conversation,
          `upkeep:${reset}`,
          input,
          context,
        )
        await runtime.commit(async (tx) => {
          // Move on rather than retry in a loop: the review doesn't need
          // this rollup, and the next night tries it again.
          if (!episode) {
            return review
          }
          addEpisode(await familiarDoc(tx, Episodes, task.input.familiar), {
            span,
            start,
            end,
            text: episode,
            at: runtime.now(),
          })
          return rollup
        }, context)
      },

      review: (task, runtime, context) =>
        runtime.commit(async (tx) => {
          const { familiar } = task.input
          const record = await familiarRecord(tx, familiar)
          const memory = await openMemory(tx, familiar)
          const due = dueForReview(memory, runtime.now())
          if (!due.length) {
            return sleep(runtime.now())
          }
          const facts = due
            .map(
              (fact) =>
                `${fact.id} (${factDays(memory.facts, fact)}): ${fact.text}`,
            )
            .join('\n')
          const days = recentDays(
            await familiarDoc(tx, Episodes, familiar),
            upkeepDay(runtime.now(), options.timeZone),
            options.transcriptTokens,
          )
          const input = `Check these facts against what happened recently:\n${facts}\n\nThe days of the last ${REVIEW_DAYS}, oldest first:\n${days || '(none recorded)'}`
          return {
            status: 'running',
            checkpoint: {
              phase: 'recheck',
              ...(await startPass(tx, record, 'filing')),
              facts: due.map((fact) => fact.id),
              input,
            },
          }
        }, context),

      recheck: async (task, runtime, context) => {
        const { conversation, reset, facts, input } = task.state.checkpoint
        const reply = await ask(
          runtime,
          conversation,
          `upkeep:${reset}`,
          input,
          context,
        )
        await runtime.commit(async (tx) => {
          // A failed review has been reported; unstamped, its facts are
          // first in line again the next night.
          if (reply !== undefined) {
            markChecked(
              await familiarDoc(tx, MemoryUsage, task.input.familiar),
              facts,
              runtime.now(),
            )
          }
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

  // The writing tools: selected by upkeep's conversation, and left out of
  // every other's default (see harness.ts).
  const extension: Extension = defineExtension({
    name: UPKEEP_EXTENSION,
    tasks: [UpkeepTask],
    tools: upkeepTools(options.timeZone),
  })

  return {
    extension,

    /** Ensures `familiar`'s exactly one live upkeep task. */
    start: (harness: Harness, familiar: FamiliarId, context: Context) =>
      harness.commit(async (tx) => {
        const upkeep = await familiarDoc(tx, Upkeep, familiar)
        // Reads before writes: a transaction cannot read tables after writing.
        const task =
          upkeep.task === null ? undefined : await tx.task(upkeep.task)
        const live =
          task &&
          task.state.status !== 'terminal' &&
          task.state.status !== 'completing'

        // Background, so it never keeps the chat busy or is stopped with it.
        if (!live) {
          upkeep.task = await tx.createTask(
            UpkeepTask,
            { familiar },
            {
              ownership: { kind: 'conversation' },
              conversationId: familiar,
              background: true,
            },
          )
        }
      }, context),
  }
}
