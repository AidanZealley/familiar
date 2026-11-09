import {
  AssistantEntry,
  defineTask,
  ROOT_CONVERSATION_ID,
  type EntryRecord,
} from '@earendil-works/pi-durable'
import {
  SCHEDULED_KIND,
  formatAuthor,
  type Author,
  saidBy,
  type ScheduledData,
} from '../conversation/message.ts'
import type { Notify } from '../notify.ts'
import { localMinute } from '../time.ts'
import { advance, dueAt, Schedules } from './schedules.ts'
import {
  familiarDoc,
  familiarRecord,
  type FamiliarId,
} from '../workspace/familiars.ts'

type ScheduleStep =
  | { phase: 'wait' }
  /** Built in `wait`, so a rerun after a restart submits the same input. */
  | {
      phase: 'deliver'
      prompt: string
      creator?: Author
      due: number
      /** When it was delivered, if late. */
      late?: number
    }

const finished = {
  status: 'terminal',
  outcome: { status: 'completed', result: null },
} as const

/** How a due prompt starts, as the model reads it. */
export const SCHEDULED_PREFIX = '[Scheduled for '

/** Woken more than this after its time, a delivery says it's late. */
const LATE_MS = 60_000

/** Roughly what a notification shows before the system cuts it off. */
const BODY_LENGTH = 180

/** A reply as a notification's body: plain text, cut at a word near the limit. */
export function notificationBody(text: string) {
  const plain = text
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain.length <= BODY_LENGTH) {
    return plain
  }
  const cut = plain.slice(0, BODY_LENGTH)
  const space = cut.lastIndexOf(' ')
  return `${space > BODY_LENGTH / 2 ? cut.slice(0, space) : cut}…`
}

/** The schedule a task runs, and the Familiar it belongs to. */
type ScheduleInput = { familiar: FamiliarId; id: string }

/**
 * One task per schedule: it sleeps until the schedule is due, submits its
 * prompt to its Familiar's chat, and notifies the host with the reply, or
 * with the prompt if there was none, so a reminder is never lost. A task
 * that wakes to find its schedule gone finishes without doing anything:
 * cancelling is removing the schedule.
 */
export function createScheduleTask(
  notify: Notify | undefined,
  timeZone: string,
) {
  return defineTask<ScheduleInput, ScheduleStep, null>({
    name: 'familiar.schedule',
    version: 2,
    initial: () => ({ phase: 'wait' }),
    // Version 1 ran before workspaces, for the one Familiar, on the root.
    migrate: (input, checkpoint) => ({
      input: {
        familiar: ROOT_CONVERSATION_ID,
        id: (input as { id: string }).id,
      },
      checkpoint: checkpoint as ScheduleStep,
    }),
    phases: {
      wait: (task, runtime, context) =>
        runtime.commit(async (tx) => {
          const { familiar, id } = task.input
          const schedule = (await familiarDoc(tx, Schedules, familiar))[id]
          const now = runtime.now()
          // Cancelling removes the schedule.
          if (!schedule) {
            return finished
          }
          if (now < schedule.next) {
            return {
              status: 'sleeping',
              until: schedule.next,
              checkpoint: { phase: 'wait' },
            }
          }
          const due = dueAt(schedule, now, timeZone)
          return {
            status: 'running',
            checkpoint: {
              phase: 'deliver',
              prompt: schedule.prompt,
              ...(schedule.creator && { creator: schedule.creator }),
              due,
              ...(now - due >= LATE_MS && { late: now }),
            },
          }
        }, context),

      deliver: async (task, runtime, context) => {
        const { familiar, id } = task.input
        const { prompt, due, late, creator } = task.state.checkpoint
        // Rerun after a restart, this may come after the schedule was
        // cancelled, so it checks again first. Its name titles the
        // notification.
        let name: string | undefined
        await runtime.commit(async (tx) => {
          const runnable =
            (await familiarDoc(tx, Schedules, familiar))[id] !== undefined
          name = runnable
            ? (await familiarRecord(tx, familiar)).name
            : undefined
          return runnable ? undefined : finished
        }, context)
        if (name === undefined) {
          return
        }
        const conversation = await runtime.conversation(familiar, context)
        const when =
          late === undefined
            ? localMinute(due, timeZone)
            : `${localMinute(due, timeZone)}, delivered ${localMinute(late, timeZone)}`
        // Queues like any message if the conversation is busy.
        const submission = await conversation!.submit(
          {
            type: 'input',
            content: `${SCHEDULED_PREFIX}${when}${creator ? `; requested by ${formatAuthor(creator)}` : ''}] ${prompt}`,
            requestId: `schedule:${id}:${due}`,
            entry: {
              kind: SCHEDULED_KIND,
              data: {
                scheduleId: id,
                prompt,
                due,
                ...(creator && { creator }),
              } satisfies ScheduledData,
            },
          },
          context,
        )
        const settled = await submission.wait(context)

        let reply = ''
        if (settled.status === 'done') {
          // A task commit returns its next state, not values, so read into this.
          let answer: EntryRecord | undefined
          await runtime.commit(async (tx) => {
            answer = await tx.entry(AssistantEntry, settled.answer!)
          }, context)
          reply = (answer && saidBy(answer)?.text.trim()) ?? ''
        }

        // A crash between notifying and the commit below notifies again on
        // rerun: better twice than never.
        if (notify) {
          await notify(
            {
              title: name,
              body: notificationBody(reply || prompt),
              url: '/',
            },
            { scheduleId: id, creator },
          ).catch((error: unknown) => runtime.report(error))
        }

        await runtime.commit(async (tx) => {
          const next = advance(
            await familiarDoc(tx, Schedules, familiar),
            id,
            due,
            runtime.now(),
            timeZone,
          )
          return next
            ? {
                status: 'sleeping',
                until: next.next,
                checkpoint: { phase: 'wait' },
              }
            : finished
        }, context)
      },
    },
    abort: (_task, runtime, context) =>
      runtime.commit(
        () => ({ status: 'terminal', outcome: { status: 'aborted' } }),
        context,
      ),
  })
}

export type ScheduleTask = ReturnType<typeof createScheduleTask>
