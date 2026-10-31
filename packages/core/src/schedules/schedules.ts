import { defineDoc } from '@earendil-works/pi-durable'
import { parseMinute } from '../time/index.ts'
import {
  occurrenceAfter,
  occurrenceBy,
  occurrencesAfter,
  repeatProblem,
} from './repeat.ts'

/**
 * A prompt Familiar runs in the main conversation at a time, once or
 * repeating. A reminder is a schedule whose prompt says to remind the owner.
 */
export type Schedule = {
  id: string
  /** An instruction to Familiar's future self, e.g. "Remind Aidan to call Mum". */
  prompt: string
  /** A one-off's time. Exactly one of `at` and `repeat` is set. */
  at?: number
  /** An RFC 5545 RRULE in Familiar's time zone, starting at `created`. */
  repeat?: string
  /** When it is next due. */
  next: number
  created: number
}

/** Schedules by ID. The source of truth: a schedule's task does nothing once it's gone. */
export type SchedulesState = Record<string, Schedule>

export const Schedules = defineDoc<SchedulesState>({
  kind: 'familiar.schedules',
  version: 1,
  scope: 'session',
  initial: () => ({}),
  checkpointWhen: () => true, // small: always store it whole
})

/** A change the rules refuse; nothing was changed. */
export class ScheduleError extends Error {}

export type NewSchedule = {
  id: string
  prompt: string
  /** `YYYY-MM-DD HH:MM` in Familiar's time zone. */
  at?: string
  repeat?: string
}

/** Adds a schedule, due after `now`, or throws a ScheduleError saying why not. */
export function addSchedule(
  schedules: SchedulesState,
  { id, prompt, at, repeat }: NewSchedule,
  now: number,
  timeZone: string,
): Schedule {
  if (!prompt.trim()) {
    throw new ScheduleError('Give the prompt to run.')
  }
  if ((at === undefined) === (repeat === undefined)) {
    throw new ScheduleError('Give either at or repeat, not both.')
  }

  const base = { id, prompt: prompt.trim(), created: now }
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
    const problem = repeatProblem(rule)
    if (problem) {
      throw new ScheduleError(problem)
    }
    const next = occurrenceAfter(rule, now, now, timeZone)
    if (next === undefined) {
      throw new ScheduleError('That repeat never happens after now.')
    }
    schedule = { ...base, repeat: rule, next }
  }

  schedules[id] = schedule
  return schedule
}

export function cancelSchedule(schedules: SchedulesState, id: string) {
  if (!schedules[id]) {
    throw new ScheduleError(`No schedule ${id}.`)
  }
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
        occurrenceBy(schedule.repeat, schedule.created, now, timeZone) ?? 0,
      )

/**
 * After a delivery at `now`: removes a one-off or a finished repeat, or moves
 * a repeat to its next occurrence. Returns the schedule if it continues.
 */
export function advance(
  schedules: SchedulesState,
  id: string,
  now: number,
  timeZone: string,
) {
  const schedule = schedules[id]
  const next =
    schedule?.repeat === undefined
      ? undefined
      : occurrenceAfter(schedule.repeat, schedule.created, now, timeZone)
  if (next === undefined) {
    delete schedules[id]
    return undefined
  }
  schedule.next = next
  return schedule
}

/** The next few times a schedule is due, from `next`. */
export const upcoming = (
  schedule: Schedule,
  count: number,
  timeZone: string,
) =>
  schedule.repeat === undefined
    ? [schedule.next]
    : [
        schedule.next,
        ...occurrencesAfter(
          schedule.repeat,
          schedule.created,
          schedule.next,
          count - 1,
          timeZone,
        ),
      ]
