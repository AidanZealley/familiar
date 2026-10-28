import { cn } from 'cn'
import { formatDate, isPast } from '@/lib/memory'
import type { HistoryChainProps } from './types'

/**
 * A vertical stepper, newest first: what's true now on top, each earlier
 * version beneath it with the days it was true. Current versions are edited
 * on the Facts page; old ones are history and don't change.
 */
export const HistoryChain = ({ chain }: HistoryChainProps) => {
  const latest = chain.at(-1)!
  const steps = chain.toReversed()

  return (
    <article>
      {isPast(latest) && (
        <p className="mb-2 pl-[1.4rem] text-xs text-muted-foreground">
          No longer true from {formatDate(latest.until!)}; nothing replaced it.
        </p>
      )}
      <ol>
        {steps.map((fact, index) => {
          const current = !isPast(fact)
          return (
            <li key={fact.id} className="relative flex gap-3 pb-3 last:pb-0">
              {index < steps.length - 1 && (
                <span className="absolute top-4 bottom-0 left-[5px] w-px bg-border" />
              )}
              <span
                className={cn(
                  'mt-1.5 size-[11px] shrink-0 rounded-full border-2',
                  current
                    ? 'border-primary bg-primary'
                    : 'border-foreground/25 bg-background',
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">
                  {formatDate(fact.since)}
                  {current ? ' · now' : ` → ${formatDate(fact.until!)}`}
                </p>
                <p
                  className={cn('text-sm', !current && 'text-muted-foreground')}
                >
                  {fact.text}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </article>
  )
}
