import type { EpisodesState, Span } from './episodes.ts'
import {
  coreFacts,
  isPast,
  lastChecked,
  listFacts,
  type Memory,
} from './facts.ts'

/**
 * Health numbers from real data, so whether memory keeps working as it
 * grows is measured rather than assumed. Read alongside the retrieval eval;
 * docs/memory.md explains what these numbers measure and when to investigate.
 */

export type MemoryHealth = {
  facts: { current: number; core: number; past: number }
  coreCharacters: number
  /** Current facts whose last check (or save) is over 180 days old. */
  unchecked: number
  episodes: Record<Span, number>
  exchanges: number
  /** First nonempty index build after opening Familiar; not a cumulative total. */
  indexBuildMs: number | null
  /** Latest nonempty update after that build; idle polls leave it unchanged. */
  indexCatchUpMs: number | null
  search: { count: number; medianMs: number; maxMs: number }
}

/** A fact unchecked this long means the nightly review is falling behind. */
export const UNCHECKED_AFTER = 180 * 24 * 60 * 60 * 1000

/** How many recent search times are kept. They live in memory only. */
const SEARCH_SAMPLES = 200

/** The times of recent memory searches, automatic and by tool. */
export function createSearchTimes() {
  const times: number[] = []

  return {
    /** Runs a search, recording how long it took. */
    time<T>(search: () => T): T {
      const started = performance.now()
      try {
        return search()
      } finally {
        times.push(performance.now() - started)
        if (times.length > SEARCH_SAMPLES) {
          times.shift()
        }
      }
    },

    summary(): MemoryHealth['search'] {
      const sorted = times.toSorted((a, b) => a - b)
      return {
        count: sorted.length,
        medianMs:
          ((sorted[Math.floor((sorted.length - 1) / 2)] ?? 0) +
            (sorted[Math.floor(sorted.length / 2)] ?? 0)) /
          2,
        maxMs: sorted.at(-1) ?? 0,
      }
    },
  }
}

export type SearchTimes = ReturnType<typeof createSearchTimes>

export function memoryHealth(
  memory: Memory,
  episodes: EpisodesState,
  exchanges: { size: number; buildMs: number | null; catchUpMs: number | null },
  search: MemoryHealth['search'],
  now: number,
): MemoryHealth {
  const facts = memory.facts.facts
  const current = facts.filter((fact) => !isPast(fact))
  const core = coreFacts(memory.facts)
  const spans = (span: Span) =>
    episodes.episodes.filter((episode) => episode.span === span).length
  return {
    facts: {
      current: current.length,
      core: core.length,
      past: facts.length - current.length,
    },
    coreCharacters: listFacts(core).length,
    unchecked: current.filter(
      (fact) => now - lastChecked(memory.usage, fact) > UNCHECKED_AFTER,
    ).length,
    episodes: { day: spans('day'), week: spans('week'), month: spans('month') },
    exchanges: exchanges.size,
    indexBuildMs: exchanges.buildMs,
    indexCatchUpMs: exchanges.catchUpMs,
    search,
  }
}
