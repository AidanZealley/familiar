import { CheckIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { Badge } from '@/components/ui/badge'
import { sourceNames, type UpdateSource } from '@/lib/updates'
import type { SourceChoiceProps } from './types'

/**
 * Where to update from: the current source first, then the other, each with
 * its latest version. Square checks, as the UI has no round controls.
 */
export const SourceChoice = ({
  current,
  chosen,
  onChoose,
  version,
  available,
}: SourceChoiceProps) => {
  const sources: UpdateSource[] =
    current === 'main' ? ['main', 'release'] : ['release', 'main']
  return (
    <div
      role="radiogroup"
      aria-label="Update from"
      className="flex flex-col gap-1.5"
    >
      {sources.map((source) => {
        const selected = source === chosen
        const latest = available?.[source]
        return (
          <button
            key={source}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChoose(source)}
            className={cn(
              'flex items-center gap-3 border p-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              selected ? 'border-primary' : 'hover:bg-muted/50',
            )}
          >
            <span
              className={cn(
                'grid size-4 shrink-0 place-items-center border',
                selected && 'border-primary bg-primary text-primary-foreground',
              )}
            >
              {selected && <CheckIcon className="size-3" />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2 text-sm">
                {sourceNames[source]}
                {source === current && (
                  <Badge variant="secondary">Current</Badge>
                )}
              </span>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {latest
                  ? `${latest}${latest === version ? ' · running' : ''}`
                  : available
                    ? 'Version unknown'
                    : 'Checking…'}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
