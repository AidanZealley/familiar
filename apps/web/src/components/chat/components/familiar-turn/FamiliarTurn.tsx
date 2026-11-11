import { PixelAvatar } from '@/components/pixel-avatar'
import { formatTime } from '@/lib/format'
import { asId, useFamiliarSummary } from '@/lib/workspace'
import { FamiliarLink } from '@/components/familiar-link'
import type { FamiliarTurnProps } from './types'

/**
 * Part of a Familiar's turn. In a named room it sits beside a portrait
 * column: the run's first item shows the portrait, its name and when the run
 * finished; the rest line up under it. In a DM, whose header already shows
 * the Familiar, it takes the full width, with the time under the run's last
 * item, as under the person's messages.
 */
export const FamiliarTurn = ({
  familiar,
  then,
  dm,
  run,
  end,
  children,
}: FamiliarTurnProps) => {
  const summary = useFamiliarSummary(familiar)
  const at = dm ? end?.time : run?.time
  const time = at !== undefined && (
    <time
      dateTime={new Date(at).toISOString()}
      className="font-heading text-[0.7rem] text-muted-foreground tabular-nums"
    >
      {formatTime(at)}
    </time>
  )

  if (dm) {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        {children}
        {time}
      </div>
    )
  }
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
            {time}
          </p>
        )}
        {children}
      </div>
    </div>
  )
}
