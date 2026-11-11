import type { Context } from '@earendil-works/chord'
import {
  AssistantEntry,
  defineTask,
  ROOT_CONVERSATION_ID,
  type Cursor,
  type EntryRecord,
  type TaskId,
  type TaskRuntime,
  type Tx,
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
import {
  replyText,
  type ReplyData,
  type RoomScheduledData,
  type TurnResult,
} from '../rooms/log.ts'
import { dmWith, membersOf, Rooms, type RoomId } from '../rooms/rooms.ts'

type Delivery = {
  prompt: string
  creator?: Author
  due: number
}

type ScheduleStep =
  | { phase: 'wait' }
  /** Built in `wait`, so a rerun after a restart delivers the same thing. */
  | (Delivery & {
      phase: 'deliver'
      /** When it was delivered, if late. */
      late?: number
      /**
       * The room it was made in, if it's still open to it. Schedules made
       * before rooms have none, and go straight to the chat.
       */
      room?: RoomId
    })
  /** Waits for the turn its room entry caused, then notifies with its reply. */
  | (Delivery & { phase: 'notify'; turns: TaskId<TurnResult>[] })

/** Records a reminder falling due in `room`, returning the turns it causes. */
export type PostScheduled = (
  tx: Tx,
  room: RoomId,
  entry: RoomScheduledData,
  requestId: string,
) => Promise<TaskId<TurnResult>[]>

const finished = {
  status: 'terminal',
  outcome: { status: 'completed', result: null },
} as const

/** How a due prompt starts, as the model reads it. */
export const SCHEDULED_PREFIX = '[Scheduled for '

/** Woken more than this after its time, a delivery says it's late. */
const LATE_MS = 60_000

/** A due prompt as the model reads it: when it was for, who asked, and what. */
export function scheduledInput(
  {
    prompt,
    due,
    late,
    creator,
  }: Pick<RoomScheduledData, 'prompt' | 'due' | 'late' | 'creator'>,
  timeZone: string,
) {
  const when =
    late === undefined
      ? localMinute(due, timeZone)
      : `${localMinute(due, timeZone)}, delivered ${localMinute(late, timeZone)}`
  return `${SCHEDULED_PREFIX}${when}${creator ? `; requested by ${formatAuthor(creator)}` : ''}] ${prompt}`
}

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

/** The schedule task's name, by which resuming finds whether one runs. */
const SCHEDULE_TASK = 'familiar.schedule'

/** Starts the task that runs `familiar`'s schedule `id`, in the commit `tx`. */
export const startSchedule = (
  tx: Tx,
  task: ScheduleTask,
  familiar: FamiliarId,
  id: string,
) =>
  // Background, so it never keeps the conversation busy while it sleeps.
  tx.createTask(
    task,
    { familiar, id },
    {
      ownership: { kind: 'conversation' },
      conversationId: familiar,
      background: true,
    },
  )

/**
 * Whether a task still runs `familiar`'s schedule `id`. A table read, so
 * call it before the commit writes any.
 */
export async function scheduleRuns(tx: Tx, familiar: FamiliarId, id: string) {
  for (const status of ['pending', 'running', 'waiting', 'sleeping'] as const) {
    let cursor: Cursor | undefined
    do {
      const page = await tx.scanTasks(
        { conversationId: familiar, kind: SCHEDULE_TASK, status },
        100,
        cursor,
      )
      if (page.items.some((task) => (task.input as ScheduleInput).id === id)) {
        return true
      }
      cursor = page.next
    } while (cursor)
  }
  return false
}

/**
 * One task per schedule: it sleeps until the schedule is due, posts it to
 * the room it was made in, where its Familiar takes a turn, and notifies the
 * host with the reply, or with the prompt if there was none, so a reminder
 * is never lost. A schedule made before rooms submits its prompt straight to
 * the chat instead. A task that wakes to find its schedule gone finishes
 * without doing anything: cancelling is removing the schedule.
 */
export function createScheduleTask(
  notify: Notify | undefined,
  timeZone: string,
  post: PostScheduled,
) {
  type Runtime = TaskRuntime<ScheduleInput, ScheduleStep, null, object>

  /**
   * Notifies the host with `reply`, or the prompt if it's empty, then
   * sleeps until the next occurrence or finishes.
   */
  const notifyAndAdvance = async (
    { familiar, id }: ScheduleInput,
    { prompt, creator, due }: Delivery,
    name: string,
    reply: string,
    runtime: Runtime,
    context: Context,
  ) => {
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
  }

  return defineTask<ScheduleInput, ScheduleStep, null>({
    name: SCHEDULE_TASK,
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
          // Paused: a repeat skips this time, so its next stays the one it
          // would run; a one-off ends its task, and resuming starts another.
          if (schedule.paused) {
            const next =
              schedule.repeat === undefined
                ? undefined
                : advance(
                    await familiarDoc(tx, Schedules, familiar),
                    id,
                    due,
                    now,
                    timeZone,
                  )
            return next
              ? {
                  status: 'sleeping',
                  until: next.next,
                  checkpoint: { phase: 'wait' },
                }
              : finished
          }
          // A room that was archived, or that its Familiar left, takes no
          // reminders. One goes instead to the Familiar's DM with whoever
          // made it, where they'll see it; with no one behind it, to the
          // chat, and the notification still goes either way.
          const made =
            schedule.room === undefined
              ? undefined
              : (await tx.doc(Rooms)).rooms[schedule.room]
          const open =
            made &&
            !(made.kind === 'room' && made.archived) &&
            membersOf(made).includes(familiar)
          // Reads before writes: a new DM is the commit's last change.
          const room = open
            ? schedule.room
            : made && schedule.creator
              ? await dmWith(tx, familiar, schedule.creator.id)
              : undefined
          return {
            status: 'running',
            checkpoint: {
              phase: 'deliver',
              prompt: schedule.prompt,
              ...(schedule.creator && { creator: schedule.creator }),
              due,
              ...(now - due >= LATE_MS && { late: now }),
              ...(room !== undefined && { room }),
            },
          }
        }, context),

      deliver: async (task, runtime, context) => {
        const { familiar, id } = task.input
        const { phase: _, room, ...delivery } = task.state.checkpoint
        const { prompt, due, creator } = delivery
        // Rerun after a restart, this may come after the schedule was
        // cancelled, so it checks again first. Its name titles the
        // notification. In a room, posting it and waiting for the turn it
        // causes are one commit, so a rerun can't post it twice.
        let name: string | undefined
        let posted = false
        await runtime.commit(async (tx) => {
          if ((await familiarDoc(tx, Schedules, familiar))[id] === undefined) {
            return finished
          }
          name = (await familiarRecord(tx, familiar)).name
          if (room === undefined) {
            return undefined
          }
          const turns = await post(
            tx,
            room,
            { familiar, scheduleId: id, ...delivery },
            `schedule:${id}:${due}`,
          )
          posted = true
          const checkpoint = {
            phase: 'notify',
            prompt,
            due,
            ...(creator && { creator }),
            turns,
          } as const
          return turns.length
            ? { status: 'waiting', on: turns, policy: 'allSettled', checkpoint }
            : { status: 'running', checkpoint }
        }, context)
        if (name === undefined || posted) {
          return
        }

        // Queues like any message if the conversation is busy.
        const conversation = await runtime.conversation(familiar, context)
        const submission = await conversation!.submit(
          {
            type: 'input',
            content: scheduledInput(delivery, timeZone),
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
        await notifyAndAdvance(
          task.input,
          delivery,
          name,
          reply,
          runtime,
          context,
        )
      },

      notify: async (task, runtime, context) => {
        const { turns, phase: _, ...delivery } = task.state.checkpoint
        const replies = (await runtime.outcomes(turns, context)).flatMap(
          (outcome) => outcome.result?.reply ?? [],
        )
        // A task commit returns its next state, not values, so read into these.
        let name: string | undefined
        let reply = ''
        await runtime.commit(async (tx) => {
          const { familiar, id } = task.input
          // Cancelled while its turn ran: the room has the reply, but no
          // notification goes.
          if ((await familiarDoc(tx, Schedules, familiar))[id] === undefined) {
            return finished
          }
          name = (await familiarRecord(tx, familiar)).name
          for (const id of replies) {
            const data = (await tx.entry(id))?.data as ReplyData | undefined
            if (data?.outcome === 'answered') {
              reply = replyText(data).trim()
            }
          }
          return undefined
        }, context)
        if (name === undefined) {
          return
        }
        await notifyAndAdvance(
          task.input,
          delivery,
          name,
          reply,
          runtime,
          context,
        )
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
