import {
  AssistantEntry,
  defineTask,
  ROOT_CONVERSATION_ID,
  type EntryRecord,
} from '@earendil-works/pi-durable'
import {
  SCHEDULED_KIND,
  saidBy,
  type ScheduledData,
} from '../conversation/message.ts'
import { localMinute } from '../time/index.ts'
import { advance, dueAt, Schedules } from './schedules.ts'

/** What a host is asked to show the owner. */
export type Notification = { title: string; body: string; url?: string }

export type Notify = (notification: Notification) => Promise<void>

type ScheduleStep =
  | { phase: 'wait' }
  /** Built in `wait`, so a rerun after a restart submits the same input. */
  | {
      phase: 'deliver'
      prompt: string
      due: number
      /** When it was delivered, if late. */
      late?: number
    }

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

/**
 * One task per schedule: it sleeps until the schedule is due, submits its
 * prompt to the main conversation, and notifies the host with the reply, or
 * with the prompt if there was none, so a reminder is never lost. A task
 * that wakes to find its schedule gone finishes without doing anything:
 * cancelling is removing the schedule.
 */
export function createScheduleTask(
  name: string,
  notify: Notify | undefined,
  timeZone: string,
) {
  return defineTask<{ id: string }, ScheduleStep, null>({
    name: 'familiar.schedule',
    version: 1,
    initial: () => ({ phase: 'wait' }),
    phases: {
      wait: (task, runtime, context) =>
        runtime.commit(async (tx) => {
          const schedule = (await tx.doc(Schedules))[task.input.id]
          const now = runtime.now()
          if (!schedule) {
            return {
              status: 'terminal',
              outcome: { status: 'completed', result: null },
            }
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
              due,
              ...(now - due >= LATE_MS && { late: now }),
            },
          }
        }, context),

      deliver: async (task, runtime, context) => {
        const { id } = task.input
        const { prompt, due, late } = task.state.checkpoint
        const conversation = await runtime.conversation(
          ROOT_CONVERSATION_ID,
          context,
        )
        const when =
          late === undefined
            ? localMinute(due, timeZone)
            : `${localMinute(due, timeZone)}, delivered ${localMinute(late, timeZone)}`
        // Queues like any message if the conversation is busy.
        const submission = await conversation!.submit(
          {
            type: 'input',
            content: `[Scheduled for ${when}] ${prompt}`,
            requestId: `schedule:${id}:${due}`,
            entry: {
              kind: SCHEDULED_KIND,
              data: { scheduleId: id, prompt, due } satisfies ScheduledData,
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
          await notify({
            title: name,
            body: notificationBody(reply || prompt),
            url: '/',
          }).catch((error: unknown) => runtime.report(error))
        }

        await runtime.commit(async (tx) => {
          const schedule = advance(
            await tx.doc(Schedules),
            id,
            runtime.now(),
            timeZone,
          )
          return schedule
            ? {
                status: 'sleeping',
                until: schedule.next,
                checkpoint: { phase: 'wait' },
              }
            : {
                status: 'terminal',
                outcome: { status: 'completed', result: null },
              }
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
