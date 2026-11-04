import { Cron } from 'croner'

/**
 * Repeats are five-field cron expressions, such as `0 7 * * 1-5`, read in
 * Familiar's time zone. Croner owns the grammar and the calendar, including
 * daylight saving: a time the clock skips runs when the clock resumes, and
 * of one it shows twice, a daily repeat runs the first while an hourly one
 * runs both. How often a repeat may run is schedules.ts's rule, not the
 * expression's.
 */

/** The longest repeat, checked before Croner reads it. */
export const REPEAT_LENGTH = 256

/**
 * A repeat as Croner reads it, or throws saying why it isn't one. Without a
 * callback or name, Croner starts no timer and registers nothing: it's only
 * a calculator.
 */
function cronOf(repeat: string, timeZone: string) {
  if (repeat.length > REPEAT_LENGTH) {
    throw new Error(`Keep the repeat to ${REPEAT_LENGTH} characters.`)
  }
  try {
    return new Cron(repeat, { mode: '5-part', timezone: timeZone })
  } catch (error) {
    throw new Error(
      `Give the repeat as five-field cron, such as 0 7 * * 1-5: ${(error as Error).message}`,
      { cause: error },
    )
  }
}

/** Why a repeat can't be scheduled, or undefined if it can. */
export function repeatProblem(repeat: string, timeZone: string) {
  try {
    cronOf(repeat, timeZone)
    return undefined
  } catch (error) {
    return (error as Error).message
  }
}

/** The first occurrence after `time`, or undefined if there is none. */
export const nextOccurrence = (
  repeat: string,
  time: number,
  timeZone: string,
) => cronOf(repeat, timeZone).nextRun(new Date(time))?.getTime()

/**
 * The latest occurrence at or before `time`, if any. Croner looks strictly
 * before a time, to the second, and occurrences fall on whole minutes, so
 * looking before the next second includes one exactly at `time`.
 */
export const latestOccurrence = (
  repeat: string,
  time: number,
  timeZone: string,
) =>
  cronOf(repeat, timeZone)
    .previousRuns(1, new Date(time + 1000))[0]
    ?.getTime()
