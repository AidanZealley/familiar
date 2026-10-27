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
