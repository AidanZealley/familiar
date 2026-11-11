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
const weekdayDayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

/** A short date, with the year only when it isn't this year. */
const formatDay = (date: Date) =>
  date.getFullYear() === new Date().getFullYear()
    ? dayFormat.format(date)
    : dayYearFormat.format(date)

/** A `YYYY-MM-DD` day, such as a fact's `since`: `7 Jan`. */
export const formatDate = (day: string) => formatDay(localDate(day))

export const formatTime = (ms: number) => timeFormat.format(ms)

const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0)

/** A day near now: `Yesterday`, `Today`, `Tomorrow`, or `Tue 7 Jan`. */
export const formatRelativeDay = (ms: number) => {
  const days = Math.round(
    (startOfDay(ms) - startOfDay(Date.now())) / 86_400_000,
  )
  if (days === -1) {
    return 'Yesterday'
  }
  if (days === 0) {
    return 'Today'
  }
  if (days === 1) {
    return 'Tomorrow'
  }
  return weekdayDayFormat.format(ms)
}

const weekdays = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

const ordinal = (n: number) =>
  n % 100 >= 11 && n % 100 <= 13
    ? `${n}th`
    : `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`

/**
 * A schedule's cron repeat in words: `0 7 * * 1-5` is `Weekdays at 07:00`.
 * Shapes Familiar rarely makes fall back to `Repeats`.
 */
export const formatRepeat = (cron: string) => {
  const [minute = '', hour = '', date = '', month, weekday = ''] = cron
    .trim()
    .split(/\s+/)
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour) || month !== '*') {
    return 'Repeats'
  }
  const at = `at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  if (date === '*') {
    if (weekday === '*') {
      return `Every day ${at}`
    }
    if (weekday === '1-5') {
      return `Weekdays ${at}`
    }
    if (weekday === '0,6' || weekday === '6,0') {
      return `Weekends ${at}`
    }
    if (/^[0-7](,[0-7])*$/.test(weekday)) {
      const names = weekday.split(',').map((day) => weekdays[Number(day) % 7]!)
      return names.length === 1
        ? `Every ${names[0]} ${at}`
        : `${names.map((name) => name.slice(0, 3)).join(', ')} ${at}`
    }
  }
  if (/^\d+$/.test(date) && weekday === '*') {
    return `Monthly on the ${ordinal(Number(date))} ${at}`
  }
  return 'Repeats'
}

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
