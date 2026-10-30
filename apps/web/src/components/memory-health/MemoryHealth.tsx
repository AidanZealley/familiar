import { CORE_BUDGET } from '@/lib/memory'
import { HealthStatus } from './components/health-status'
import { HealthTile } from './components/health-tile'
import { count, ms, statusesOf } from './status'
import type { MemoryHealthProps } from './types'

/** One tile per number that matters, with a status where it can go wrong. */
export const MemoryHealth = ({ health }: MemoryHealthProps) => {
  const status = statusesOf(health)
  const share = Math.min(1, health.coreCharacters / CORE_BUDGET)
  const episodes =
    health.episodes.day + health.episodes.week + health.episodes.month

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <HealthTile label="Current facts" value={count(health.facts.current)}>
        <span>
          {count(health.facts.core)} in core · {count(health.facts.past)} past
        </span>
      </HealthTile>
      <HealthTile label="Core" value={`${Math.round(share * 100)}%`}>
        <div
          className="h-2 bg-primary/15"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={CORE_BUDGET}
          aria-valuenow={health.coreCharacters}
          aria-label="Core characters used"
        >
          <div
            className={
              status.core === 'warning'
                ? 'h-full bg-amber-500'
                : 'h-full bg-primary'
            }
            style={{ width: `${share * 100}%` }}
          />
        </div>
        <span>
          {count(health.coreCharacters)} of {count(CORE_BUDGET)} characters
        </span>
        <HealthStatus status={status.core} />
      </HealthTile>
      <HealthTile
        label="Unchecked for six months"
        value={count(health.unchecked)}
      >
        <span>Facts the nightly review hasn’t reached.</span>
        <HealthStatus status={status.review} />
      </HealthTile>
      <HealthTile label="Episodes" value={count(episodes)}>
        <span>
          {count(health.episodes.day)} days · {count(health.episodes.week)}{' '}
          weeks · {count(health.episodes.month)} months
        </span>
      </HealthTile>
      <HealthTile label="Exchanges indexed" value={count(health.exchanges)}>
        <span>
          Built in {ms(health.indexBuildMs)} · latest update{' '}
          {ms(health.indexCatchUpMs)}
        </span>
        <HealthStatus status={status.index} />
      </HealthTile>
      <HealthTile label="Median search" value={ms(health.search.medianMs)}>
        <span>
          Slowest {ms(health.search.maxMs)} · {count(health.search.count)}{' '}
          searches
        </span>
        <HealthStatus status={status.search} />
      </HealthTile>
    </div>
  )
}
