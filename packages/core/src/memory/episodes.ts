import { defineDoc } from '@earendil-works/pi-durable'
import { formatDay as format, parseDay as parse } from '../time/index.ts'

/**
 * Episodes: what happened, as summaries. Upkeep writes one per pass over a
 * day's conversation and rolls finished weeks and months up from those, so
 * "what was going on in March?" needs no raw transcript.
 */

export type Span = 'day' | 'week' | 'month'

export type Episode = {
  /** `e1`, `e2`, …: never reused. */
  id: string
  span: Span
  /** Local dates, `YYYY-MM-DD`, inclusive. */
  start: string
  end: string
  text: string
  /** When it was written, in ms since the epoch. */
  at: number
}

export type EpisodesState = {
  episodes: Episode[]
  /** Next episode number. */
  next: number
}

/** Its own document: it grows every day for years, and the memory document is sent to clients whole. */
export const Episodes = defineDoc<EpisodesState>({
  kind: 'familiar.episodes',
  version: 1,
  scope: 'session',
  initial: () => ({ episodes: [], next: 1 }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 50,
})

const MONTHS =
  'january february march april may june july august september october november december'.split(
    ' ',
  )
const MONTH = `(${MONTHS.join('|')})`
const ORDINAL = '(?:st|nd|rd|th)?'

export type DateRange = { start: string; end: string }

/**
 * The days and months a message names, such as "in March", "4 March 2025",
 * "March 4" or "2025-03-04", resolved to their most recent past occurrence
 * when no year is given. Only explicit dates count: ordinary words like "may"
 * or a passing number never become dates, so recall stays quiet for them.
 */
export function datesIn(text: string, today: string): DateRange[] {
  const ranges: DateRange[] = []
  const now = parse(today)
  const monthOf = (name: string) => MONTHS.indexOf(name.toLowerCase())
  const year = (given: string | undefined, month: number, date = 1) => {
    if (given) return Number(given)
    // The most recent one that has started.
    const candidate = new Date(now.getFullYear(), month, date)
    return candidate > now ? now.getFullYear() - 1 : now.getFullYear()
  }
  const day = (y: number, month: number, date: number) => {
    const at = new Date(y, month, date)
    // Rejects dates like 31 February rather than rolling them over.
    if (at.getMonth() !== month) return
    ranges.push({ start: format(at), end: format(at) })
  }
  const month = (y: number, index: number) =>
    ranges.push({
      start: format(new Date(y, index, 1)),
      end: format(new Date(y, index + 1, 0)),
    })

  for (const [, y, m, d] of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g))
    day(Number(y), Number(m) - 1, Number(d))
  const numbered = [
    // 4 March, 4th of March 2025
    new RegExp(
      `\\b(\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?${MONTH}\\b(?:,?\\s+(\\d{4}))?`,
      'gi',
    ),
    // March 4, March 4th, 2025
    new RegExp(
      `\\b${MONTH}\\s+(\\d{1,2})${ORDINAL}\\b(?:,?\\s+(\\d{4}))?`,
      'gi',
    ),
  ]
  for (const [, date, name, y] of text.matchAll(numbered[0])) {
    const index = monthOf(name)
    day(year(y, index, Number(date)), index, Number(date))
  }
  for (const [, name, date, y] of text.matchAll(numbered[1])) {
    const index = monthOf(name)
    day(year(y, index, Number(date)), index, Number(date))
  }
  // March 2025, or a month after a word that makes it one: "in March",
  // "early March", "since May". A bare "may" is a verb far more often.
  for (const [, name, y] of text.matchAll(
    new RegExp(`\\b${MONTH}\\s+(\\d{4})\\b`, 'gi'),
  ))
    month(Number(y), monthOf(name))
  for (const [, name] of text.matchAll(
    new RegExp(
      `\\b(?:in|during|throughout|since|until|by|of|early|late|mid|last|this|next)\\s+(?:early\\s+|late\\s+|mid-?\\s*)?${MONTH}\\b(?!\\s+\\d)`,
      'gi',
    ),
  ))
    month(year(undefined, monthOf(name)), monthOf(name))
  return ranges
}

const DAY_MS = 24 * 60 * 60 * 1000
const dayNumber = (day: string) => {
  const [year, month, date] = day.split('-').map(Number)
  return Date.UTC(year, month - 1, date) / DAY_MS
}

/**
 * How closely an episode's days match a range: shared days over all the days
 * either covers. 1 for the same span, so "in March" favours March's summary
 * and "4 March" that day's episode; 0 when they don't overlap.
 */
export function dateFit(episode: Episode, range: DateRange) {
  const [a, b] = [dayNumber(episode.start), dayNumber(episode.end)]
  const [c, d] = [dayNumber(range.start), dayNumber(range.end)]
  const shared = Math.min(b, d) - Math.max(a, c) + 1
  return shared > 0 ? shared / (Math.max(b, d) - Math.min(a, c) + 1) : 0
}

export function addEpisode(
  state: EpisodesState,
  episode: Omit<Episode, 'id'>,
): Episode {
  const added = { id: `e${state.next}`, ...episode }
  state.next++
  state.episodes.push(added)
  return added
}

/** The Monday-to-Sunday week and the calendar month a day falls in. */
function periodsOf(day: string) {
  const date = parse(day)
  const monday = new Date(date)
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const first = new Date(date.getFullYear(), date.getMonth(), 1)
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  return [
    { span: 'week' as const, start: format(monday), end: format(sunday) },
    { span: 'month' as const, start: format(first), end: format(last) },
  ]
}

/** Every day an episode covers. */
function daysOf(episode: Episode) {
  const days: string[] = []
  const last = parse(episode.end)
  for (
    let date = parse(episode.start);
    date <= last;
    date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
  )
    days.push(format(date))
  return days
}

export type Rollup = {
  span: 'week' | 'month'
  start: string
  end: string
  /** The day episodes overlapping it, oldest first. */
  days: Episode[]
}

/**
 * The earliest week or month that ended before `today`, has day episodes and
 * isn't rolled up yet. Worked out from the episodes themselves, so a pass
 * that was missed (the machine was off on a Monday) is caught up later.
 */
export function dueRollup(
  state: EpisodesState,
  today: string,
): Rollup | undefined {
  const days = state.episodes.filter((episode) => episode.span === 'day')
  const done = new Set(
    state.episodes.map((episode) => `${episode.span}:${episode.start}`),
  )
  // An episode spanning several days (Familiar was off, or a chat ran past
  // midnight into a new week) counts towards every period it overlaps.
  const due = days
    .flatMap((day) => daysOf(day).flatMap(periodsOf))
    .filter(
      (period) =>
        period.end < today && !done.has(`${period.span}:${period.start}`),
    )
    // Oldest first; a week before a month that ends the same day.
    .sort(
      (a, b) => a.end.localeCompare(b.end) || (a.span === 'week' ? -1 : 1),
    )[0]
  return (
    due && {
      ...due,
      days: days.filter((day) => day.start <= due.end && day.end >= due.start),
    }
  )
}
