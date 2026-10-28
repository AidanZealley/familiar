import { Type } from '@earendil-works/pi-ai'
import { defineExtension, defineTool } from '@earendil-works/pi-durable'

/**
 * Time: the model's current_time tool, and how Familiar writes dates. Every
 * date it stores or shows is a local calendar day, so a day means the same
 * thing in episodes, recall and upkeep.
 */

const pad = (value: number) => String(value).padStart(2, '0')

/** A date as `YYYY-MM-DD`, in local time. */
export const formatDay = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/** Local midnight of a `YYYY-MM-DD` day. */
export const parseDay = (day: string) => {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date)
}

/** The local day of a time, in ms since the epoch. */
export const localDay = (at: number) => formatDay(new Date(at))

/** The local day and minute of a time, as `YYYY-MM-DD HH:MM`. */
export const localMinute = (at: number) => {
  const date = new Date(at)
  return `${formatDay(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** The time of a local `YYYY-MM-DD HH:MM`, or undefined if no such minute exists. */
export const parseMinute = (minute: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(minute.trim())
  if (!match) {
    return undefined
  }
  const [year, month, day, hours, minutes] = match.slice(1).map(Number)
  const at = new Date(year, month - 1, day, hours, minutes).getTime()
  // Dates roll over (31 September is 1 October), so only an exact round trip
  // is the minute that was meant. This also refuses the hour a clock skips.
  return localMinute(at) === minute.trim() ? at : undefined
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** A local minute with its weekday, as `Fri 2026-10-30 07:00`, so a misread date shows. */
export const weekdayMinute = (at: number) =>
  `${WEEKDAYS[new Date(at).getDay()]} ${localMinute(at)}`

// A tool rather than a prompt section: a prompt that changes every minute
// would lose the provider's prompt cache on every request.
const currentTime = defineTool({
  name: 'current_time',
  description:
    "The current date and time, in the host's time zone unless one is given.",
  parameters: Type.Object({
    timeZone: Type.Optional(
      Type.String({ description: 'IANA time zone, e.g. Europe/London' }),
    ),
  }),
  replay: 'safe',
  execute: async ({ timeZone }, api) => ({
    output: [
      {
        type: 'text',
        text: new Date(api.now()).toLocaleString('en-GB', {
          timeZone,
          dateStyle: 'full',
          timeStyle: 'long',
        }),
      },
    ],
  }),
})

export const TimeExtension = defineExtension({
  name: 'familiar.time',
  tools: [currentTime],
})
