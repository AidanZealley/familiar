import type { MemoryHealth } from '@familiar-ai/client'
import { CORE_BUDGET } from '@/lib/memory'

const number = new Intl.NumberFormat()

export const count = (value: number) => number.format(value)

/** Milliseconds, to one decimal place below 10. */
export const ms = (value: number | null) =>
  value === null
    ? 'Not yet'
    : `${value < 10 ? value.toFixed(1) : number.format(Math.round(value))} ms`

export type Status = 'good' | 'warning' | 'idle'

/**
 * Whether each number that can go wrong needs attention. A fact unchecked
 * six months means the nightly review is falling behind; the timings are
 * where a slower, persisted index would start to pay off.
 */
export const statusesOf = (
  health: MemoryHealth,
): Record<'core' | 'review' | 'index' | 'search', Status> => ({
  core: health.coreCharacters / CORE_BUDGET < 0.9 ? 'good' : 'warning',
  review: health.unchecked === 0 ? 'good' : 'warning',
  index:
    health.indexBuildMs === null
      ? 'idle'
      : health.indexBuildMs < 1_000
        ? 'good'
        : 'warning',
  search:
    health.search.count === 0
      ? 'idle'
      : health.search.medianMs < 50
        ? 'good'
        : 'warning',
})
