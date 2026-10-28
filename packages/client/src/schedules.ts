import type { Schedule, SchedulesState } from '@familiar/core/http'

/** Schedules, soonest first. */
export const schedulesByNext = (schedules: SchedulesState | null | undefined) =>
  Object.values(schedules ?? {}).toSorted((a, b) => a.next - b.next)

const DAYS: Record<string, string> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
}

const pad = (value: string) => value.padStart(2, '0')

const ordinal = (day: number) => {
  const tens = day % 100
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] ?? 'th')
  return `${day}${suffix}`
}

/**
 * A repeat in words, such as `Weekdays at 07:00`, for the common shapes
 * models write; anything else is shown as its RRULE.
 */
export function describeRepeat(repeat: Schedule['repeat']) {
  if (!repeat) {
    return undefined
  }
  const parts = Object.fromEntries(
    repeat
      .replace(/^RRULE:/i, '')
      .split(';')
      .map((part) => part.split('=') as [string, string]),
  )
  const { FREQ, BYDAY, BYHOUR, BYMINUTE, BYMONTHDAY } = parts
  const interval = Number(parts.INTERVAL ?? 1)
  const known = new Set([
    'FREQ',
    'BYDAY',
    'BYHOUR',
    'BYMINUTE',
    'BYMONTHDAY',
    'INTERVAL',
  ])
  // A single time only; lists of hours and other parts are left as written.
  if (
    Object.keys(parts).some((key) => !known.has(key)) ||
    BYMINUTE === undefined ||
    BYMINUTE.includes(',') ||
    BYHOUR?.includes(',')
  ) {
    return repeat
  }
  const time = BYHOUR && `at ${pad(BYHOUR)}:${pad(BYMINUTE)}`
  const every = (one: string, many: string) =>
    interval === 1 ? `Every ${one}` : `Every ${interval} ${many}`

  if (FREQ === 'HOURLY' && !BYHOUR && !BYDAY) {
    return `${every('hour', 'hours')} at :${pad(BYMINUTE)}`
  }
  if (!time) {
    return repeat
  }
  if (FREQ === 'DAILY' && !BYDAY && !BYMONTHDAY) {
    return `${every('day', 'days')} ${time}`
  }
  if (FREQ === 'WEEKLY' && BYDAY && !BYMONTHDAY && interval === 1) {
    const days = BYDAY.split(',')
    if (days.some((day) => !DAYS[day])) {
      return repeat
    }
    const set = days.toSorted().join(',')
    if (set === 'FR,MO,TH,TU,WE') {
      return `Weekdays ${time}`
    }
    if (set === 'SA,SU') {
      return `Weekends ${time}`
    }
    return `Every ${days.map((day) => DAYS[day]).join(', ')} ${time}`
  }
  if (FREQ === 'MONTHLY' && BYMONTHDAY && !BYDAY && /^\d+$/.test(BYMONTHDAY)) {
    return `${every('month', 'months')} on the ${ordinal(Number(BYMONTHDAY))} ${time}`
  }
  return repeat
}
