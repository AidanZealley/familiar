import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  defineExtension,
  section,
  type DocumentWatch,
  type Harness,
} from '@earendil-works/pi-durable'
import {
  cancelSchedule,
  DEFAULT_MAX_SCHEDULES,
  scheduleOf,
  Schedules,
  type SchedulesState,
} from './schedules.ts'
import type { Notify } from '../notify.ts'
import {
  createScheduleTask,
  scheduleRuns,
  startSchedule,
  type PostScheduled,
} from './task.ts'
import { scheduleTools } from './tools.ts'
import {
  familiarDoc,
  watchFamiliarDoc,
  type FamiliarId,
} from '../workspace/familiars.ts'

export type { Schedule, SchedulesState } from './schedules.ts'
export {
  DEFAULT_MAX_SCHEDULES,
  SCHEDULE_LIMITS,
  ScheduleError,
} from './schedules.ts'

export type SchedulesApi = {
  watch(): Promise<DocumentWatch<SchedulesState>>
  /** Rejects with a ScheduleError, changing nothing, when there is no such schedule. */
  cancel(id: string): Promise<void>
  /**
   * Stops it running until `resume`. A repeat skips the times that fall due
   * meanwhile; a one-off whose time passes runs, late, once resumed.
   * Rejects as `cancel`.
   */
  pause(id: string): Promise<void>
  /** Runs it again from its next time, or now if that has passed. Rejects as `cancel`. */
  resume(id: string): Promise<void>
}

// Kept stable: a prompt section that changes resends the prompt and loses the
// provider's prompt cache.
const guidance = `Some messages start with [Scheduled for …]. They are prompts set up earlier with the schedule tool, often at the owner's request, arriving now that they're due; if a time says "delivered", it arrived late. Carry the prompt out now and speak to the owner directly: for a reminder, remind them. Your reply is sent to their devices as a notification, so put what matters first. They may answer it like any message, for example to snooze it, which is scheduling it again. A repeat is five-field cron in local time, such as 0 7 * * 1-5 for 07:00 on weekdays, and runs at most hourly.`

const context = BACKGROUND_CONTEXT

/** `maxSchedules`, defaulted, or throws if it isn't a positive whole number. */
export function checkMaxSchedules(maxSchedules = DEFAULT_MAX_SCHEDULES) {
  if (!Number.isSafeInteger(maxSchedules) || maxSchedules < 1) {
    throw new Error('maxSchedules must be a positive whole number.')
  }
  return maxSchedules
}

/**
 * Schedules: prompts a Familiar runs in its chat at a time, once or
 * repeating, notifying the host with each reply. Install `extension`, then
 * call `open` for each Familiar once the Harness is open.
 */
export function createSchedules(options: {
  notify?: Notify
  timeZone: string
  /** Checked by `checkMaxSchedules`. */
  maxSchedules: number
  /** Posts a due schedule to its room (see rooms/log.ts). */
  post: PostScheduled
}) {
  const { maxSchedules } = options
  const task = createScheduleTask(
    options.notify,
    options.timeZone,
    options.post,
  )
  const extension = defineExtension({
    name: 'familiar.schedules',
    tasks: [task],
    tools: scheduleTools(task, options.timeZone, maxSchedules),
    sections: [section('schedules', () => guidance)],
  })

  return {
    extension,
    /** `familiar`'s schedules. */
    open: async (
      harness: Harness,
      familiar: FamiliarId,
    ): Promise<SchedulesApi> => {
      // Watches only attach to documents that exist.
      await harness.commit(async (tx) => {
        await familiarDoc(tx, Schedules, familiar)
      }, context)
      return {
        watch: async () =>
          (await watchFamiliarDoc(harness, Schedules, familiar, context))!,
        // The schedule's task wakes to find it gone and finishes.
        cancel: (id) =>
          harness.commit(
            async (tx) =>
              cancelSchedule(await familiarDoc(tx, Schedules, familiar), id),
            context,
          ),
        // Its task finds it paused when it wakes.
        pause: (id) =>
          harness.commit(async (tx) => {
            scheduleOf(await familiarDoc(tx, Schedules, familiar), id).paused =
              true
          }, context),
        // A paused one-off's task ended at its time; a repeat's still sleeps.
        resume: (id) =>
          harness.commit(async (tx) => {
            const schedule = scheduleOf(
              await familiarDoc(tx, Schedules, familiar),
              id,
            )
            if (!schedule.paused) {
              return
            }
            // Reads before writes: a transaction cannot read tables after writing.
            const runs = await scheduleRuns(tx, familiar, id)
            delete schedule.paused
            if (!runs) {
              await startSchedule(tx, task, familiar, id)
            }
          }, context),
      }
    },
  }
}
