import type { Context } from '@earendil-works/chord'
import {
  AssistantEntry,
  configure,
  defineExtension,
  defineTask,
  ResetEntry,
  ROOT_CONVERSATION_ID,
  type Extension,
  type ConversationId,
  type EntryId,
  type EntryRecord,
  type Harness,
  type ModelRef,
  type TaskRuntime,
  type Tx,
} from '@earendil-works/pi-durable'
import { saidBy } from '../../conversation/message.ts'
import { localDay } from '../../time/index.ts'
import { addEpisode, dueRollup, Episodes } from '../episodes.ts'
import { coreFacts, Memory, rebalanceCore } from '../facts.ts'
import { instructions, rollupInstructions } from './prompts.ts'
import { nextUpkeep, Upkeep, upkeepDay } from './schedule.ts'
import { newMessages } from './transcript.ts'

type UpkeepStep =
  | { phase: 'schedule' }
  /** Selects the next batch, on waking at 04:00 or after a completed batch. */
  | { phase: 'pass' }
  /** Built in `pass`, so a rerun after a restart submits the same input. */
  | {
      phase: 'consolidate'
      conversation: ConversationId
      reset: EntryId
      newest: EntryId
      input: string
      /**
       * The days the messages span, for the day's episode. Absent on a pass
       * checkpointed before episodes existed, which then writes none.
       */
      start?: string
      end?: string
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

export type UpkeepOptions = {
  model: ModelRef
  name: string
  transcriptTokens: number
  extension: Extension
}

/**
 * Daily memory consolidation: at 04:00 a background task reviews unreviewed
 * messages in bounded, oldest-first day batches in a separate conversation
 * with memory tools. Install `extension`, then call `start`
 * once the Harness is open.
 */
export function createUpkeep(options: UpkeepOptions) {
  const sleep = (now: number) =>
    ({
      status: 'sleeping',
      until: nextUpkeep(now),
      checkpoint: { phase: 'pass' },
    }) as const

  /**
   * Submits `input` to an upkeep conversation and returns the reply, or
   * undefined after reporting a failure. `requestId` finds the same
   * submission if a restart reruns the phase.
   */
  const ask = async (
    runtime: TaskRuntime<null, UpkeepStep, null, object>,
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
   * Passes start from nothing, so the upkeep conversation never grows.
   * Appended directly: nothing else runs there, and the last pass settled.
   */
  const resetIn = (tx: Tx, conversation: ConversationId) =>
    tx.appendEntry(ResetEntry, conversation, { head: 'self' })

  /** Once the backlog is clear, write any rollups that are due. */
  const rollup = { status: 'running', checkpoint: { phase: 'rollup' } } as const

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
          if (upkeep.conversation === null) {
            return sleep(runtime.now())
          }
          const found = await newMessages(
            tx,
            upkeep.through,
            options.transcriptTokens,
            options.name,
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
          const facts = coreFacts(await tx.doc(Memory))
          const dates = facts.length
            ? facts.map((fact) => `${fact.id}: ${localDay(fact.at)}`).join('\n')
            : '(no facts yet)'
          const input = `Recent conversation, oldest first:\n${found.transcript}\n\nWhen each fact was last written:\n${dates}`
          const reset = await resetIn(tx, upkeep.conversation)
          return {
            status: 'running',
            checkpoint: {
              phase: 'consolidate',
              conversation: upkeep.conversation,
              reset: reset.id,
              newest: found.newest,
              input,
              start: found.start,
              end: found.end,
            },
          }
        }, context),

      consolidate: async (task, runtime, context) => {
        const { conversation, reset, newest, input, start, end } =
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

          const upkeep = await tx.doc(Upkeep)
          upkeep.through = newest

          if (episode && start && end) {
            addEpisode(await tx.doc(Episodes), {
              span: 'day',
              start,
              end,
              text: episode,
              at: runtime.now(),
            })
          }

          rebalanceCore(await tx.doc(Memory))
          return { status: 'running', checkpoint: { phase: 'pass' } } as const
        }, context)
      },

      rollup: (_task, runtime, context) =>
        runtime.commit(async (tx) => {
          const upkeep = await tx.doc(Upkeep)
          const due = dueRollup(
            await tx.doc(Episodes),
            upkeepDay(runtime.now()),
          )
          if (!due || upkeep.rollups === null) {
            return sleep(runtime.now())
          }
          const days = due.days
            .map(
              (day) =>
                `${day.start === day.end ? day.start : `${day.start} to ${day.end}`}: ${day.text}`,
            )
            .join('\n\n')
          const input = `The ${due.span} of ${due.start} to ${due.end}:\n\n${days}`
          const reset = await resetIn(tx, upkeep.rollups)
          return {
            status: 'running',
            checkpoint: {
              phase: 'summarize',
              conversation: upkeep.rollups,
              reset: reset.id,
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
          // Stop rather than retry in a loop; the next pass tries again.
          if (!episode) {
            return sleep(runtime.now())
          }
          addEpisode(await tx.doc(Episodes), {
            span,
            start,
            end,
            text: episode,
            at: runtime.now(),
          })
          return rollup
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

        const createConversation = async () =>
          (await tx.createConversation({ ownership: { kind: 'ownerless' } })).id

        upkeep.conversation ??= await createConversation()
        upkeep.rollups ??= await createConversation()

        // Every open, so a change of model or wording applies to the next pass.
        await configure(tx, upkeep.conversation, {
          model: options.model,
          extensions: [options.extension],
          instructions: instructions(options.name),
        })
        await configure(tx, upkeep.rollups, {
          model: options.model,
          extensions: [],
          instructions: rollupInstructions(options.name),
        })

        // Background, so it never keeps the main conversation busy or is
        // stopped with it.
        if (!live) {
          upkeep.task = await tx.createTask(UpkeepTask, null, {
            ownership: { kind: 'conversation' },
            conversationId: ROOT_CONVERSATION_ID,
            background: true,
          })
        }
      }, context),
  }
}
