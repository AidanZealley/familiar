import { PixelAvatar } from '@/components/pixel-avatar'
import { formatTime } from '@/lib/format'
import { asId, useFamiliarSummary } from '@/lib/workspace'
import { FamiliarLink } from '@/components/familiar-link'
import type { FamiliarTurnProps } from './types'

/**
 * Part of a Familiar's turn, beside its portrait column: the run's first
 * shows the portrait, its name and when the run finished; the rest line up
 * under it.
 */
export const FamiliarTurn = ({
  familiar,
  then,
  run,
  children,
}: FamiliarTurnProps) => {
  const summary = useFamiliarSummary(familiar)

  return (
    <div className="flex min-w-0 gap-2.5">
      {run ? (
        <FamiliarLink id={familiar} then={then} className="self-start">
          <PixelAvatar
            familiar={summary ?? { id: asId(familiar), name: then ?? '?' }}
            talking={run.live}
          />
        </FamiliarLink>
      ) : (
        <span className="w-8 shrink-0" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {run && (
          <p className="flex items-baseline gap-2 font-heading text-xs">
            <FamiliarLink id={familiar} then={then} />
            {run.time !== undefined && (
              <time
                dateTime={new Date(run.time).toISOString()}
                className="text-[0.7rem] text-muted-foreground tabular-nums"
              >
                {formatTime(run.time)}
              </time>
            )}
          </p>
        )}
        {children}
      </div>
    </div>
  )
}
