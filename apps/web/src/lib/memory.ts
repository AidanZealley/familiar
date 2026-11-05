import type { Episode, Fact } from '@familiar-ai/client'
import { localDate, monthFormat } from '@/lib/format'

/**
 * Views of the memory the store mirrors, for the Memory pages. Read-only:
 * every change goes through the store's commands.
 */

export const isPast = (fact: Fact) => fact.until !== undefined

/** Pinned first, then most important, then newest. */
const byStanding = (a: Fact, b: Fact) =>
  Number(!!b.pinned) - Number(!!a.pinned) ||
  b.importance - a.importance ||
  b.saved - a.saved

export const coreFacts = (facts: readonly Fact[]) =>
  facts.filter((fact) => fact.core && !isPast(fact)).toSorted(byStanding)

/** Current facts outside core: kept, and recalled when relevant. */
export const reserveFacts = (facts: readonly Fact[]) =>
  facts.filter((fact) => !fact.core && !isPast(fact)).toSorted(byStanding)

/** A fact as the model sees it, one line of core. */
const line = (fact: Fact) => `${fact.id}: ${fact.text}`

export const factSize = (fact: Fact) => line(fact).length

/** The characters core's facts take of `CORE_BUDGET`. */
export const coreSize = (core: readonly Fact[]) =>
  core.map(line).join('\n').length

/**
 * Every fact that has changed, as a chain of its versions from newest to
 * oldest: one per fact that is the latest of its line and either replaced
 * something or was retired. Chains come most recently changed first.
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
      chain.push(fact)
      previous = fact.replaces?.[0]
    }
    chains.push(chain)
  }
  const changed = ([latest]: Fact[]) => latest.until ?? latest.since
  return chains.toSorted((a, b) => changed(b).localeCompare(changed(a)))
}

export type EpisodeMonth = {
  /** `YYYY-MM`. */
  key: string
  label: string
  /** The month's own episode, written once it has ended. */
  summary?: Episode
  /** Its weeks and days, newest first, each week above its days. */
  entries: Episode[]
}

/** Episodes grouped by the month they start in, newest month first. */
export const episodeMonths = (episodes: readonly Episode[]): EpisodeMonth[] => {
  const months = new Map<string, EpisodeMonth>()
  for (const episode of episodes) {
    const key = episode.start.slice(0, 7)
    const month = months.get(key) ?? {
      key,
      label: monthFormat.format(localDate(`${key}-01`)),
      entries: [],
    }
    if (episode.span === 'month') {
      month.summary = episode
    } else {
      month.entries.push(episode)
    }
    months.set(key, month)
  }
  return [...months.values()]
    .map((month) => ({
      ...month,
      // A week ends with its last day, so on a tie the week goes first.
      entries: month.entries.toSorted(
        (a, b) =>
          b.end.localeCompare(a.end) ||
          Number(b.span === 'week') - Number(a.span === 'week'),
      ),
    }))
    .toSorted((a, b) => b.key.localeCompare(a.key))
}
