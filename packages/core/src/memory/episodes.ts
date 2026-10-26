import { defineDoc } from '@earendil-works/pi-durable'

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

const pad = (value: number) => String(value).padStart(2, '0')
const format = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const parse = (day: string) => {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date)
}

/** The local date of a time, matching upkeep's local 04:00. */
export const localDay = (at: number) => format(new Date(at))

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

export type Rollup = {
  span: 'week' | 'month'
  start: string
  end: string
  /** The day episodes it summarises, oldest first. */
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
  const due = days
    .flatMap((day) => periodsOf(day.start))
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
      days: days.filter(
        (day) => day.start >= due.start && day.start <= due.end,
      ),
    }
  )
}
