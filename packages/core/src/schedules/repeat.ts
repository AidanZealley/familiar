import * as rruleModule from 'rrule'
import { wallClock, zonedTime } from '../time/index.ts'

// Node loads rrule's CommonJS build, whose exports arrive only as the default;
// bundlers such as Wrangler's load its ES build, which has no default.
const rrule: typeof rruleModule =
  Reflect.get(rruleModule, 'default') ?? rruleModule

/**
 * Repeats are RFC 5545 RRULEs, read in Familiar's time zone. rrule computes
 * in UTC, so it's given wall-clock times dressed as UTC and its answers are
 * read back the same way: a daily 07:00 stays 07:00 across a daylight saving
 * change. An occurrence the clock skips moves forward with `zonedTime`, and
 * one it shows twice is the earlier time.
 */

/** A time as the UTC time with the same calendar fields in `timeZone`. */
const toFloating = (at: number, timeZone: string) => {
  const { year, month, day, hour, minute, second } = wallClock(at, timeZone)
  return Date.UTC(year, month - 1, day, hour, minute, second)
}

const fromFloating = (date: Date, timeZone: string) =>
  zonedTime(
    {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
    },
    timeZone,
  )

const DAY_MS = 24 * 60 * 60 * 1000

/** A rule that starts at `start`, the minute its schedule was created. */
function ruleOf(repeat: string, start: number, timeZone: string) {
  const startMinute = toFloating(start, timeZone)
  return rrule.rrulestr(repeat.replace(/^RRULE:/i, ''), {
    dtstart: new Date(startMinute - (startMinute % 60_000)),
  })
}

/**
 * The rule's occurrences as times, in order, within a day of `time`'s wall
 * clock. Around a clock change, wall-clock order and time order can differ
 * by up to the change, so searches look this far either side.
 */
function around(repeat: string, start: number, time: number, timeZone: string) {
  const rule = ruleOf(repeat, start, timeZone)
  const floating = toFloating(time, timeZone)
  const near = rule
    .between(new Date(floating - DAY_MS), new Date(floating + DAY_MS), true)
    .map((date) => fromFloating(date, timeZone))
    .sort((a, b) => a - b)
  return { rule, floating, near }
}

/** The first occurrence after `time`, or undefined once the rule has ended. */
export function occurrenceAfter(
  repeat: string,
  start: number,
  time: number,
  timeZone: string,
) {
  const { rule, floating, near } = around(repeat, start, time, timeZone)
  const next = near.find((at) => at > time)
  if (next !== undefined) {
    return next
  }
  const later = rule.after(new Date(floating + DAY_MS))
  return later ? fromFloating(later, timeZone) : undefined
}

/** The latest occurrence at or before `time`, if any. */
export function occurrenceBy(
  repeat: string,
  start: number,
  time: number,
  timeZone: string,
) {
  const { rule, floating, near } = around(repeat, start, time, timeZone)
  const latest = near.findLast((at) => at <= time)
  if (latest !== undefined) {
    return latest
  }
  const earlier = rule.before(new Date(floating - DAY_MS))
  return earlier ? fromFloating(earlier, timeZone) : undefined
}

/** Up to `count` occurrences after `time`. */
export function occurrencesAfter(
  repeat: string,
  start: number,
  time: number,
  count: number,
  timeZone: string,
) {
  const times: number[] = []
  let at: number | undefined = time
  while (times.length < count) {
    at = occurrenceAfter(repeat, start, at, timeZone)
    if (at === undefined) {
      break
    }
    times.push(at)
  }
  return times
}

/**
 * Why a repeat can't be scheduled, or undefined if it can. A repeat names
 * its own time, so it never silently inherits the minute it was set.
 */
export function repeatProblem(repeat: string) {
  let options
  try {
    options = rrule.rrulestr(repeat.replace(/^RRULE:/i, '')).origOptions
  } catch (error) {
    return `Not a valid RRULE: ${(error as Error).message}`
  }
  if (options.freq === undefined) {
    return 'The RRULE needs a FREQ.'
  }
  if (
    options.freq === rrule.RRule.MINUTELY ||
    options.freq === rrule.RRule.SECONDLY
  ) {
    return 'Repeats can be at most hourly.'
  }
  if (options.byminute === undefined || options.byminute === null) {
    return 'Give the time with BYMINUTE (and BYHOUR unless it repeats hourly).'
  }
  if (
    options.freq !== rrule.RRule.HOURLY &&
    (options.byhour === undefined || options.byhour === null)
  ) {
    return 'Give the time with BYHOUR and BYMINUTE.'
  }
  return undefined
}
