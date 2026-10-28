import type { Episode, Fact } from '@familiar/client'
import {
  CalendarDaysIcon,
  HistoryIcon,
  ListIcon,
  type LucideIcon,
} from 'lucide-react'

/**
 * Views of the memory the store mirrors, shared by the Memory pages and the
 * chat. Read-only: every change goes through the store's actions.
 */

/** Mirrors core's `CORE_BUDGET`, which the client can't import. */
export const CORE_BUDGET = 6_000

/** Mirrors core's `CORE_IMPORTANCE`: facts this important go in core while there's room. */
export const CORE_IMPORTANCE = 3

export const isPast = (fact: Fact) => fact.until !== undefined

/** Pinned first, then most important, then newest. */
const byStanding = (a: Fact, b: Fact) =>
  Number(!!b.pinned) - Number(!!a.pinned) ||
  b.importance - a.importance ||
  b.at - a.at

export const coreFacts = (facts: readonly Fact[]) =>
  facts.filter((fact) => fact.core && !isPast(fact)).toSorted(byStanding)

/** Current facts outside core: kept, and recalled when relevant. */
export const reserveFacts = (facts: readonly Fact[]) =>
  facts.filter((fact) => !fact.core && !isPast(fact)).toSorted(byStanding)

/** A fact's length as the model sees it, which core's budget measures. */
export const factSize = (fact: Fact) => `${fact.id}: ${fact.text}`.length

/** Characters core takes; core joins its facts with newlines. */
export const coreSize = (facts: readonly Fact[]) => {
  const core = coreFacts(facts)
  return Math.max(
    0,
    core.reduce((sum, fact) => sum + factSize(fact) + 1, 0) - 1,
  )
}

/**
 * Each fact's history, oldest first: one chain per fact that hasn't been
 * superseded, if it superseded something or was retired. Newest change first.
 */
export const historyChains = (facts: readonly Fact[]) => {
  const byId = new Map(facts.map((fact) => [fact.id, fact]))
  const superseded = new Set(facts.flatMap((fact) => fact.replaces ?? []))
  const chains: Fact[][] = []
  for (const head of facts) {
    if (superseded.has(head.id)) {
      continue
    }
    if (!isPast(head) && !head.replaces?.length) {
      continue
    }
    const chain = [head]
    // A merge replaces several; follow the first, the fact it revised.
    let previous = head.replaces?.[0]
    while (previous && byId.has(previous)) {
      const fact = byId.get(previous)!
      chain.unshift(fact)
      previous = fact.replaces?.[0]
    }
    chains.push(chain)
  }
  const changed = (chain: Fact[]) => chain.at(-1)!.until ?? chain.at(-1)!.at
  return chains.toSorted((a, b) => changed(b) - changed(a))
}

/** The fact that superseded a past one, if any. */
export const successorOf = (facts: readonly Fact[], fact: Fact) =>
  facts.find((other) => other.replaces?.includes(fact.id))

export type EpisodeMonth = {
  /** `YYYY-MM`. */
  key: string
  label: string
  month?: Episode
  weeks: Episode[]
  days: Episode[]
}

/** Episodes grouped by the month they start in, newest month first. */
export const episodeMonths = (episodes: readonly Episode[]): EpisodeMonth[] => {
  const months = new Map<string, EpisodeMonth>()
  for (const episode of episodes) {
    const key = episode.start.slice(0, 7)
    const month = months.get(key) ?? {
      key,
      label: monthFormat.format(localDate(`${key}-01`)),
      weeks: [],
      days: [],
    }
    if (episode.span === 'month') {
      month.month = episode
    } else if (episode.span === 'week') {
      month.weeks.push(episode)
    } else {
      month.days.push(episode)
    }
    months.set(key, month)
  }
  return [...months.values()].toSorted((a, b) => b.key.localeCompare(a.key))
}

/** The Memory pages, for every nav that links to them. */
export const memorySections: {
  to: '/memory' | '/memory/history' | '/memory/episodes'
  label: string
  icon: LucideIcon
  description: string
}[] = [
  {
    to: '/memory',
    label: 'Facts',
    icon: ListIcon,
    description: 'What Familiar knows now: pinned, core and reserve.',
  },
  {
    to: '/memory/history',
    label: 'History',
    icon: HistoryIcon,
    description: 'How facts changed over time.',
  },
  {
    to: '/memory/episodes',
    label: 'Episodes',
    icon: CalendarDaysIcon,
    description: 'What happened, by day, week and month.',
  },
]

/** A `YYYY-MM-DD` date at local noon, so no time zone moves it a day. */
const localDate = (date: string) => new Date(`${date}T12:00:00`)

const monthFormat = new Intl.DateTimeFormat(undefined, {
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

/** A short date, with the year only when it isn't this year. */
export const formatDay = (ms: number) =>
  new Date(ms).getFullYear() === new Date().getFullYear()
    ? dayFormat.format(ms)
    : dayYearFormat.format(ms)

export const formatTime = (ms: number) => timeFormat.format(ms)

/** An episode's dates: `7 Jan` for a day, `22–28 Dec` for a week. */
export const formatSpan = (episode: Episode) => {
  const start = localDate(episode.start)
  if (episode.span === 'day') {
    return formatDay(start.getTime())
  }
  if (episode.span === 'month') {
    return monthFormat.format(start)
  }
  return dayFormat.formatRange(start, localDate(episode.end))
}
