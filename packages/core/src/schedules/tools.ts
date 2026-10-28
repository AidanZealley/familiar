import { Type } from '@earendil-works/pi-ai'
import { defineTool, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import { weekdayMinute } from '../time/index.ts'
import {
  addSchedule,
  cancelSchedule,
  Schedules,
  upcoming,
  type Schedule,
} from './schedules.ts'
import type { ScheduleTask } from './task.ts'

const text = (value: string) => ({
  output: [{ type: 'text' as const, text: value }],
})

/** A schedule as the model reads it: what, and when, in local time. */
function describe(schedule: Schedule) {
  const when = upcoming(schedule, 3).map(weekdayMinute).join(', ')
  return schedule.repeat === undefined
    ? `${schedule.id}: at ${when}: ${schedule.prompt}`
    : `${schedule.id}: ${schedule.repeat}, next ${when}: ${schedule.prompt}`
}

/** schedule, list_schedules and cancel_schedule. */
export function scheduleTools(task: ScheduleTask) {
  const schedule = defineTool({
    name: 'schedule',
    description:
      'Run a prompt in this conversation at a local time, once or repeating; your reply is sent to the owner\'s devices as a notification. Use it for reminders and for anything to do later or regularly. Write the prompt as an instruction to your future self, e.g. "Remind Aidan to call Mum", not as the reminder\'s text. To change a schedule, cancel it and schedule again.',
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
            'Repeating, as an RFC 5545 RRULE in local time with its time, e.g. FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=7;BYMINUTE=0',
        }),
      ),
    }),
    // The schedule's ID is this call's, so a rerun finds what it made.
    replay: 'safe',
    execute: async (args, api, context) => {
      const id = `s${api.taskId}`
      const created = await api.commit(async (tx) => {
        const schedules = await tx.doc(Schedules)
        if (schedules[id]) {
          return schedules[id]
        }
        const added = addSchedule(schedules, { id, ...args }, api.now())
        // Background, so it never keeps the conversation busy while it sleeps.
        await tx.createTask(
          task,
          { id },
          {
            ownership: { kind: 'conversation' },
            conversationId: ROOT_CONVERSATION_ID,
            background: true,
          },
        )
        return added
      }, context)
      return text(`Scheduled ${describe(created)}`)
    },
  })

  const listSchedules = defineTool({
    name: 'list_schedules',
    description:
      'Every schedule (reminders included) with its ID, when it next runs and its prompt.',
    parameters: Type.Object({}),
    replay: 'safe',
    execute: async (_args, api, context) => {
      const schedules = await api.commit(
        async (tx) => Object.values(await tx.doc(Schedules)),
        context,
      )
      return text(
        schedules.length
          ? schedules
              .sort((a, b) => a.next - b.next)
              .map(describe)
              .join('\n')
          : 'No schedules.',
      )
    },
  })

  const cancel = defineTool({
    name: 'cancel_schedule',
    description: 'Cancel a schedule or reminder by its ID.',
    parameters: Type.Object({ id: Type.String() }),
    replay: 'safe',
    execute: async ({ id }, api, context) => {
      await api.commit(
        async (tx) => cancelSchedule(await tx.doc(Schedules), id),
        context,
      )
      return text(`Cancelled ${id}.`)
    },
  })

  return [schedule, listSchedules, cancel]
}
