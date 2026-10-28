// rrule ships CommonJS only, which Node's ESM loader can't name exports of.
import rrule from 'rrule'

/**
 * Repeats are RFC 5545 RRULEs, read in local time. rrule computes in UTC, so
 * it's given local wall-clock times dressed as UTC and its answers are read
 * back the same way: a daily 07:00 stays 07:00 across a daylight saving change.
 */

/** A local time as the UTC time with the same calendar fields. */
const toFloating = (at: number) => {
  const date = new Date(at)
  return new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
    ),
  )
}

const fromFloating = (date: Date) =>
  new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ).getTime()

/** A rule that starts at `start`, the minute its schedule was created. */
function ruleOf(repeat: string, start: number) {
  const startMinute = new Date(start)
  startMinute.setSeconds(0, 0)
  return rrule.rrulestr(repeat.replace(/^RRULE:/i, ''), {
    dtstart: toFloating(startMinute.getTime()),
  })
}

/** The first occurrence after `time`, or undefined once the rule has ended. */
export function occurrenceAfter(repeat: string, start: number, time: number) {
  const next = ruleOf(repeat, start).after(toFloating(time))
  return next ? fromFloating(next) : undefined
}

/** The latest occurrence at or before `time`, if any. */
export function occurrenceBy(repeat: string, start: number, time: number) {
  const latest = ruleOf(repeat, start).before(toFloating(time), true)
  return latest ? fromFloating(latest) : undefined
}

/** Up to `count` occurrences after `time`. */
export function occurrencesAfter(
  repeat: string,
  start: number,
  time: number,
  count: number,
) {
  const times: number[] = []
  let at: number | undefined = time
  while (times.length < count) {
    at = occurrenceAfter(repeat, start, at)
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
