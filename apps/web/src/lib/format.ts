import type { Episode } from '@familiar-ai/client'

/** A `YYYY-MM-DD` date at local noon, so no time zone moves it a day. */
export const localDate = (date: string) => new Date(`${date}T12:00:00`)

export const monthFormat = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
})
const dayFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
})
const dayYearFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })
const nextFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

/** A short date, with the year only when it isn't this year. */
const formatDay = (date: Date) =>
  date.getFullYear() === new Date().getFullYear()
    ? dayFormat.format(date)
    : dayYearFormat.format(date)

/** A `YYYY-MM-DD` day, such as a fact's `since`: `7 Jan`. */
export const formatDate = (day: string) => formatDay(localDate(day))

export const formatTime = (ms: number) => timeFormat.format(ms)

/** When a schedule next fires: `Tue 7 Jan, 09:00`. */
export const formatNext = (ms: number) => nextFormat.format(ms)

/** An episode's dates: `7 Jan` for a day, `22–28 Dec` for a week. */
export const formatSpan = (episode: Episode) => {
  const start = localDate(episode.start)
  if (episode.span === 'day') {
    return formatDay(start)
  }
  if (episode.span === 'month') {
    return monthFormat.format(start)
  }
  return dayFormat.formatRange(start, localDate(episode.end))
}
