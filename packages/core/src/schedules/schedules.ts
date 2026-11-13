import { defineDocFamily } from '@earendil-works/pi-durable'
import type { Author } from '../conversation/message.ts'
import type { RoomId } from '../rooms/rooms.ts'
import { parseMinute } from '../time.ts'
import {
  latestOccurrence,
  nextOccurrence,
  REPEAT_LENGTH,
  repeatProblem,
} from './repeat.ts'

/**
 * A prompt a Familiar runs in its chat at a time, once or
 * repeating. A reminder is a schedule whose prompt says to remind the owner.
 */
export type Schedule = {
  id: string
  /** Snapshot of the person who requested it, when there is one. */
  creator?: Author
  /** An instruction to Familiar's future self, e.g. "Remind Aidan to call Mum". */
  prompt: string
  /**
   * The room it was made in, where it runs when due. Absent for one made
   * outside a room, which runs in the chat.
   */
  room?: RoomId
  /** A one-off's time. Exactly one of `at` and `repeat` is set. */
  at?: number
  /** A five-field cron expression in Familiar's time zone, e.g. `0 7 * * 1-5`. */
  repeat?: string
  /** When it is next due, paused or not. */
  next: number
  created: number
  /**
   * Paused by the owner: it doesn't run until resumed. A repeat skips the
   * times that fall due meanwhile, so `next` stays the time it would run;
   * a one-off whose time passes runs, late, once resumed.
   */
  paused?: true
}

/** Schedules by ID. The source of truth: a schedule's task does nothing once it's gone. */
export type SchedulesState = Record<string, Schedule>

export const Schedules = defineDocFamily<SchedulesState, null>({
  kind: 'familiar.schedules',
  version: 1,
  scope: 'session',
  family: true,
  initial: () => ({}),
  checkpointWhen: () => true, // small: always store it whole
})

/**
 * The chat tools that change a Familiar's schedules. Memory shows filing
 * where a reply used one, since what a schedule holds is kept here, never
 * in memory.
 */
export const SCHEDULE_CHANGES: ReadonlySet<string> = new Set([
  'schedule',
  'update_schedule',
  'cancel_schedule',
])

/** A change the rules refuse; nothing was changed. */
export class ScheduleError extends Error {}

/** Bounds on what one schedule may hold, enforced when it's added. */
export const SCHEDULE_LIMITS = {
  /** An instruction to Familiar's future self, not a document. */
  prompt: 2_000,
  repeat: REPEAT_LENGTH,
} as const

/**
 * How many schedules a Familiar keeps unless its host says otherwise. Each is
 * a sleeping task, and the whole document is stored on every change, so it
 * stays small: 50 at the longest prompt is about 100 KB. A person's
 * reminders and routines fit with room to spare; a runaway loop doesn't.
 */
export const DEFAULT_MAX_SCHEDULES = 50

/**
 * The least elapsed time between a repeat's occurrences. An expression can
 * ask for more often, such as every five minutes, and a clock change can
 * bring two times closer; either way the closer ones are skipped.
 */
const REPEAT_GAP_MS = 60 * 60 * 1000

/**
 * A repeat's first occurrence after `time` and at least `REPEAT_GAP_MS`
 * after `previous`, the one before it, skipping any closer. Every next
 * occurrence comes from here, so a repeat never runs more than hourly.
 */
const occurrenceFollowing = (
  repeat: string,
  previous: number | undefined,
  time: number,
  timeZone: string,
) =>
  nextOccurrence(
    repeat,
    previous === undefined
      ? time
      : Math.max(time, previous + REPEAT_GAP_MS - 1),
    timeZone,
  )

export type NewSchedule = {
  id: string
  /** Snapshot of the person who requested it, when there is one. */
  creator?: Author
  room?: RoomId
  prompt: string
  /** `YYYY-MM-DD HH:MM` in Familiar's time zone. */
  at?: string
  repeat?: string
}

/**
 * Adds a schedule, due after `now`, or throws a ScheduleError saying why not:
 * every rule a new schedule must meet is checked here, including that there
 * are fewer than `maxSchedules` already.
 */
export function addSchedule(
  schedules: SchedulesState,
  { id, prompt, at, repeat, creator, room }: NewSchedule,
  now: number,
  timeZone: string,
  maxSchedules: number,
): Schedule {
  if (!prompt.trim()) {
    throw new ScheduleError('Give the prompt to run.')
  }
  if (prompt.length > SCHEDULE_LIMITS.prompt) {
    throw new ScheduleError(
      `Keep the prompt to ${SCHEDULE_LIMITS.prompt} characters.`,
    )
  }
  if ((at === undefined) === (repeat === undefined)) {
    throw new ScheduleError('Give either at or repeat, not both.')
  }
  if (Object.keys(schedules).length >= maxSchedules) {
    throw new ScheduleError(
      `There are already ${maxSchedules} schedules, the most this Familiar keeps. Cancel one first.`,
    )
  }

  const base = {
    id,
    prompt: prompt.trim(),
    created: now,
    ...(creator && { creator }),
    ...(room !== undefined && { room }),
  }
  let schedule: Schedule
  if (at !== undefined) {
    const time = parseMinute(at, timeZone)
    if (time === undefined) {
      throw new ScheduleError(
        `${at} is not a time as YYYY-MM-DD HH:MM that exists in ${timeZone}.`,
      )
    }
    if (time <= now) {
      throw new ScheduleError(`${at} has already passed.`)
    }
    schedule = { ...base, at: time, next: time }
  } else {
    const rule = repeat!.trim()
    const problem = repeatProblem(rule, timeZone)
    if (problem) {
      throw new ScheduleError(problem)
    }
    const next = occurrenceFollowing(rule, undefined, now, timeZone)
    if (next === undefined) {
      throw new ScheduleError('That repeat never happens after now.')
    }
    schedule = { ...base, repeat: rule, next }
  }

  schedules[id] = schedule
  return schedule
}

/** The schedule `id`; throws a ScheduleError if there's none. */
export function scheduleOf(schedules: SchedulesState, id: string) {
  const schedule = schedules[id]
  if (!schedule) {
    throw new ScheduleError(`No schedule ${id}.`)
  }
  return schedule
}

export type ScheduleChange = Partial<
  Pick<NewSchedule, 'prompt' | 'at' | 'repeat'>
>

/**
 * Changes a schedule's prompt or when it runs, keeping who made it and
 * where it runs, or throws a ScheduleError saying why not. A new time is a
 * new schedule under `newId`, so the task sleeping for the old time finds
 * it gone and stops; a new prompt alone keeps its ID. Returns the schedule
 * as it now is.
 */
export function updateSchedule(
  schedules: SchedulesState,
  id: string,
  change: ScheduleChange,
  newId: string,
  now: number,
  timeZone: string,
): Schedule {
  const old = scheduleOf(schedules, id)
  const prompt = change.prompt ?? old.prompt
  if (change.at === undefined && change.repeat === undefined) {
    if (!prompt.trim() || prompt.length > SCHEDULE_LIMITS.prompt) {
      throw new ScheduleError(
        `Give the prompt to run, of at most ${SCHEDULE_LIMITS.prompt} characters.`,
      )
    }
    old.prompt = prompt.trim()
    return old
  }
  const rest = { ...schedules }
  delete rest[id]
  const added = addSchedule(
    rest,
    {
      id: newId,
      prompt,
      at: change.at,
      repeat: change.repeat,
      creator: old.creator,
      room: old.room,
    },
    now,
    timeZone,
    Infinity,
  )
  if (old.paused) {
    added.paused = true
  }
  delete schedules[id]
  schedules[newId] = added
  return added
}

export function cancelSchedule(schedules: SchedulesState, id: string) {
  scheduleOf(schedules, id)
  delete schedules[id]
}

/**
 * The occurrence to deliver on waking at `now`: a repeat that missed several
 * delivers only the latest, so there is never a backlog.
 */
export const dueAt = (schedule: Schedule, now: number, timeZone: string) =>
  schedule.repeat === undefined
    ? schedule.next
    : Math.max(
        schedule.next,
        latestOccurrence(schedule.repeat, now, timeZone) ?? 0,
      )

/**
 * After delivering the occurrence due at `due`, at `now`: removes a one-off
 * or a finished repeat, or moves a repeat to its next occurrence. Returns
 * the schedule if it continues.
 */
export function advance(
  schedules: SchedulesState,
  id: string,
  due: number,
  now: number,
  timeZone: string,
) {
  const schedule = schedules[id]
  const next =
    schedule?.repeat === undefined
      ? undefined
      : occurrenceFollowing(schedule.repeat, due, now, timeZone)
  if (next === undefined) {
    delete schedules[id]
    return undefined
  }
  schedule.next = next
  return schedule
}

/** Up to `count` times a schedule is due, from `next`. */
export function upcoming(schedule: Schedule, count: number, timeZone: string) {
  const times = [schedule.next]
  const { repeat } = schedule
  while (repeat !== undefined && times.length < count) {
    const previous = times.at(-1)!
    const next = occurrenceFollowing(repeat, previous, previous, timeZone)
    if (next === undefined) {
      break
    }
    times.push(next)
  }
  return times
}
