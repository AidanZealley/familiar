import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  defineExtension,
  section,
  type DocumentWatch,
  type Harness,
} from '@earendil-works/pi-durable'
import { cancelSchedule, Schedules, type SchedulesState } from './schedules.ts'
import { createScheduleTask, type Notify } from './task.ts'
import { scheduleTools } from './tools.ts'

export type { Schedule, SchedulesState } from './schedules.ts'
export { ScheduleError } from './schedules.ts'
export type { Notification, Notify } from './task.ts'

export type SchedulesApi = {
  watch(): Promise<DocumentWatch<SchedulesState>>
  /** Rejects with a ScheduleError, changing nothing, when there is no such schedule. */
  cancel(id: string): Promise<void>
}

// Kept stable: a prompt section that changes resends the prompt and loses the
// provider's prompt cache.
const guidance = `Some messages start with [Scheduled for …]. They are prompts set up earlier with the schedule tool, often at the owner's request, arriving now that they're due; if a time says "delivered", it arrived late. Carry the prompt out now and speak to the owner directly: for a reminder, remind them. Your reply is sent to their devices as a notification, so put what matters first. They may answer it like any message, for example to snooze it, which is scheduling it again.`

const context = BACKGROUND_CONTEXT

/**
 * Schedules: prompts Familiar runs in the main conversation at a time, once
 * or repeating, notifying the host with each reply. Install `extension`,
 * then call `start` once the Harness is open.
 */
export function createSchedules(options: { name: string; notify?: Notify }) {
  const task = createScheduleTask(options.name, options.notify)
  const extension = defineExtension({
    name: 'familiar.schedules',
    tasks: [task],
    tools: scheduleTools(task),
    sections: [section('schedules', () => guidance)],
  })

  return {
    extension,
    start: async (harness: Harness): Promise<SchedulesApi> => {
      // Watches only attach to documents that exist.
      await harness.commit(async (tx) => {
        await tx.doc(Schedules)
      }, context)
      return {
        watch: async () => (await harness.watchDoc(Schedules, context))!,
        // The schedule's task wakes to find it gone and finishes.
        cancel: (id) =>
          harness.commit(
            async (tx) => cancelSchedule(await tx.doc(Schedules), id),
            context,
          ),
      }
    },
  }
}
