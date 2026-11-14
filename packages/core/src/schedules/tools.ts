import { Type } from '@earendil-works/pi-ai'
import type { Context } from '@earendil-works/chord'
import type { ToolExecutionApi, Tx } from '@earendil-works/pi-durable'
import type { InRoom } from '../conversation/message.ts'
import { callInput, defineTool, familiar } from '../tools.ts'
import {
  familiarDoc,
  familiarFor,
  type FamiliarId,
} from '../workspace/familiars.ts'
import { weekdayMinute } from '../time.ts'
import {
  addSchedule,
  cancelSchedule,
  Schedules,
  updateSchedule,
  upcoming,
  type Schedule,
  type SchedulesState,
} from './schedules.ts'
import { startSchedule, type ScheduleTask } from './task.ts'

const text = (value: string) => ({
  output: [{ type: 'text' as const, text: value }],
})

/** A schedule as the model reads it: what, and when, in Familiar's time zone. */
function describe(schedule: Schedule, timeZone: string) {
  const when = upcoming(schedule, 3, timeZone)
    .map((at) => weekdayMinute(at, timeZone))
    .join(', ')
  const paused = schedule.paused ? ' (paused by the owner)' : ''
  return schedule.repeat === undefined
    ? `${schedule.id}: at ${when}${paused}: ${schedule.prompt}`
    : `${schedule.id}: ${schedule.repeat}, next ${when}${paused}: ${schedule.prompt}`
}

/** Commits `use` with the schedules of the Familiar whose chat calls it. */
const withSchedules = <T>(
  api: ToolExecutionApi,
  context: Context,
  use: (
    schedules: SchedulesState,
    familiar: FamiliarId,
    tx: Tx,
  ) => T | Promise<T>,
) =>
  api.commit(async (tx) => {
    const owner = await familiarFor(tx, api.conversationId)
    return use(await familiarDoc(tx, Schedules, owner), owner, tx)
  }, context)

/** schedule, list_schedules, update_schedule and cancel_schedule. */
export function scheduleTools(
  task: ScheduleTask,
  timeZone: string,
  maxSchedules: number,
) {
  const schedule = defineTool({
    name: 'schedule',
    description:
      'Run a prompt in this conversation at a local time, once or repeating; your reply is sent to the owner\'s devices as a notification. Use it for reminders and for anything to do later or regularly. Write the prompt as an instruction to your future self, e.g. "Remind Aidan to call Mum", not as the reminder\'s text. To change a schedule, use update_schedule.',
    parameters: Type.Object({
      prompt: Type.String({
        description: 'What to do when it is due, as an instruction to yourself',
      }),
      at: Type.Optional(
        Type.String({
          description: 'Once, at this local time: YYYY-MM-DD HH:MM',
        }),
      ),
      repeat: Type.Optional(
        Type.String({
          description:
            'Repeating, as five-field cron (minute hour day-of-month month day-of-week) in local time, e.g. 0 7 * * 1-5 for 07:00 on weekdays. Runs at most hourly; closer times are skipped.',
        }),
      ),
    }),
    // The schedule's ID is this call's, so a rerun finds what it made.
    replay: 'safe',
    execute: async (args, api, context) => {
      const id = `s${api.taskId}`
      const creator = await familiar(context).author()
      const created = await withSchedules(
        api,
        context,
        async (schedules, owner, tx) => {
          if (schedules[id]) {
            return schedules[id]
          }
          // Destinations are data: it runs in the room this call's input
          // came from, if any.
          const room = ((await callInput(tx, api.taskId))?.data as InRoom)?.room
          const added = addSchedule(
            schedules,
            { id, ...args, creator, ...(room !== undefined && { room }) },
            api.now(),
            timeZone,
            maxSchedules,
          )
          await startSchedule(tx, task, owner, id)
          return added
        },
      )
      return text(`Scheduled ${describe(created, timeZone)}`)
    },
  })

  const listSchedules = defineTool({
    name: 'list_schedules',
    description:
      'Every schedule (reminders included) with its ID, when it next runs and its prompt.',
    parameters: Type.Object({}),
    replay: 'safe',
    execute: async (_args, api, context) => {
      const schedules = await withSchedules(api, context, (schedules) =>
        Object.values(schedules),
      )
      return text(
        schedules.length
          ? schedules
              .sort((a, b) => a.next - b.next)
              .map((schedule) => describe(schedule, timeZone))
              .join('\n')
          : 'No schedules.',
      )
    },
  })

  const update = defineTool({
    name: 'update_schedule',
    description:
      'Change a schedule by its ID: its prompt, or when it runs. When someone gives feedback about a recurring job ("include the links", "skip the weather"), put it into that job\'s prompt here rather than remembering it.',
    parameters: Type.Object({
      id: Type.String(),
      prompt: Type.Optional(
        Type.String({
          description: 'The whole new prompt, as an instruction to yourself',
        }),
      ),
      at: Type.Optional(
        Type.String({
          description: 'Once, at this local time instead: YYYY-MM-DD HH:MM',
        }),
      ),
      repeat: Type.Optional(
        Type.String({
          description: 'Repeating instead, as five-field cron in local time',
        }),
      ),
    }),
    // A new time's schedule takes this call's ID, so a rerun finds what it made.
    replay: 'safe',
    execute: async ({ id, ...change }, api, context) => {
      const newId = `s${api.taskId}`
      const updated = await withSchedules(
        api,
        context,
        async (schedules, owner, tx) => {
          if (schedules[newId]) {
            return schedules[newId]
          }
          const schedule = updateSchedule(
            schedules,
            id,
            change,
            newId,
            api.now(),
            timeZone,
          )
          if (schedule.id === newId) {
            await startSchedule(tx, task, owner, newId)
          }
          return schedule
        },
      )
      return text(`Updated: ${describe(updated, timeZone)}`)
    },
  })

  const cancel = defineTool({
    name: 'cancel_schedule',
    description: 'Cancel a schedule or reminder by its ID.',
    parameters: Type.Object({ id: Type.String() }),
    replay: 'safe',
    execute: async ({ id }, api, context) => {
      await withSchedules(api, context, (schedules) =>
        cancelSchedule(schedules, id),
      )
      return text(`Cancelled ${id}.`)
    },
  })

  return [schedule, listSchedules, update, cancel]
}
