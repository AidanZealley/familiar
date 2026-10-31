import { Type } from '@earendil-works/pi-ai'
import { defineExtension, defineTool } from '@earendil-works/pi-durable'

/**
 * Time: the model's current_time tool, and every conversion between an
 * instant and a calendar. Familiar reads calendars in one IANA time zone,
 * given by its host, so a day means the same thing in episodes, recall,
 * schedules and upkeep. Nothing here reads the process's own zone.
 *
 * Calendar days (`YYYY-MM-DD`) need no zone: their arithmetic runs on UTC
 * dates. Only turning an instant into a day or minute, or back, does.
 */

const pad = (value: number) => String(value).padStart(2, '0')

/** A calendar day's date, as UTC midnight. */
export const parseDay = (day: string) => {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date))
}

/** A date's UTC calendar day, as `YYYY-MM-DD`. Pairs with `parseDay`. */
export const formatDay = (date: Date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`

/** The day `count` days after `day`, or before if negative. */
export const addDays = (day: string, count: number) => {
  const date = parseDay(day)
  date.setUTCDate(date.getUTCDate() + count)
  return formatDay(date)
}

/** A time's calendar fields in a zone. `month` counts from 1. */
export type WallClock = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

const formatter = (timeZone: string) => {
  let format = formatters.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(timeZone, format)
  }
  return format
}

/**
 * Throws a RangeError unless `timeZone` is an IANA zone this runtime knows,
 * such as `Europe/London`.
 */
export function checkTimeZone(timeZone: string) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) {
    throw new RangeError('Familiar needs a timeZone, such as Europe/London.')
  }
  try {
    if (/^[+-]/.test(timeZone)) {
      throw new RangeError('Fixed offsets are not IANA zone names.')
    }
    formatter(timeZone)
  } catch {
    throw new RangeError(`${timeZone} is not a known IANA time zone.`)
  }
}

/** The calendar fields of a time in `timeZone`. */
export function wallClock(at: number, timeZone: string): WallClock {
  const fields: Record<string, number> = {}
  for (const { type, value } of formatter(timeZone).formatToParts(at)) {
    fields[type] = Number(value)
  }
  const { year, month, day, hour, minute, second } = fields
  return { year, month, day, hour, minute, second }
}

const asUtc = (wall: WallClock) =>
  Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  )

const sameWall = (a: WallClock, b: WallClock) => asUtc(a) === asUtc(b)

/** How far `timeZone` is ahead of UTC at `at`, in ms. */
const offsetAt = (at: number, timeZone: string) =>
  asUtc(wallClock(at, timeZone)) - Math.floor(at / 1000) * 1000

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The time a wall clock in `timeZone` shows `wall`, resolved as Temporal's
 * `compatible` disambiguation does: a time a clock shows twice (it went
 * back) is the earlier one, and a time it skips (it went forward) moves
 * forward by the skipped length, so 02:30 on a spring-forward night is 03:30.
 */
export function zonedTime(wall: WallClock, timeZone: string) {
  const guess = asUtc(wall)
  // Offsets a day either side bracket any change near this wall time.
  const before = guess - offsetAt(guess - DAY_MS, timeZone)
  const after = guess - offsetAt(guess + DAY_MS, timeZone)
  const matches = (at: number) => sameWall(wallClock(at, timeZone), wall)
  return matches(before) || !matches(after) ? before : after
}

/** When `day` reaches `hour`:00 on a wall clock in `timeZone`. */
export const hourOn = (day: string, hour: number, timeZone: string) => {
  const [year, month, date] = day.split('-').map(Number)
  return zonedTime(
    { year, month, day: date, hour, minute: 0, second: 0 },
    timeZone,
  )
}

const dayOf = ({ year, month, day }: WallClock) =>
  `${year}-${pad(month)}-${pad(day)}`

/** The calendar day of a time in `timeZone`, as `YYYY-MM-DD`. */
export const localDay = (at: number, timeZone: string) =>
  dayOf(wallClock(at, timeZone))

/** The day and minute of a time in `timeZone`, as `YYYY-MM-DD HH:MM`. */
export const localMinute = (at: number, timeZone: string) => {
  const wall = wallClock(at, timeZone)
  return `${dayOf(wall)} ${pad(wall.hour)}:${pad(wall.minute)}`
}

/**
 * The time of a `YYYY-MM-DD HH:MM` in `timeZone`, or undefined if no such
 * minute exists there.
 */
export const parseMinute = (minute: string, timeZone: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(minute.trim())
  if (!match) {
    return undefined
  }
  const [year, month, day, hour, minutes] = match.slice(1).map(Number)
  const at = zonedTime(
    { year, month, day, hour, minute: minutes, second: 0 },
    timeZone,
  )
  // Dates roll over (31 September is 1 October) and a skipped minute moves
  // forward, so only an exact round trip is the minute that was meant.
  return localMinute(at, timeZone) === minute.trim() ? at : undefined
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** A minute in `timeZone` with its weekday, as `Fri 2026-10-30 07:00`, so a misread date shows. */
export const weekdayMinute = (at: number, timeZone: string) =>
  `${WEEKDAYS[parseDay(localDay(at, timeZone)).getUTCDay()]} ${localMinute(at, timeZone)}`

/** The current_time tool, answering in `timeZone` unless the model asks for another. */
export function createTime(timeZone: string) {
  // A tool rather than a prompt section: a prompt that changes every minute
  // would lose the provider's prompt cache on every request.
  const currentTime = defineTool({
    name: 'current_time',
    description: `The current date and time, in the owner's time zone (${timeZone}) unless one is given.`,
    parameters: Type.Object({
      timeZone: Type.Optional(
        Type.String({ description: 'IANA time zone, e.g. Europe/London' }),
      ),
    }),
    replay: 'safe',
    execute: async (args, api) => ({
      output: [
        {
          type: 'text',
          text: new Date(api.now()).toLocaleString('en-GB', {
            timeZone: args.timeZone ?? timeZone,
            dateStyle: 'full',
            timeStyle: 'long',
          }),
        },
      ],
    }),
  })

  return defineExtension({ name: 'familiar.time', tools: [currentTime] })
}
