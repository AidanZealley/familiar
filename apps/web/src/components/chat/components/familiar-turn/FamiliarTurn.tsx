import { HourglassSpinner } from '@/components/hourglass-spinner'
import { PixelAvatar } from '@/components/pixel-avatar'
import { formatTime } from '@/lib/format'
import { asId, useFamiliarSummary } from '@/lib/workspace'
import { FamiliarLink } from '@/components/familiar-link'
import type { FamiliarTurnProps } from './types'

/**
 * Shared layout for live and posted turns. In a room, the first item shows
 * the portrait and name, with a timestamp once the turn has finished.
 * Later items align with its content. DMs use the full width and put the
 * timestamp below the last item.
 */
export const FamiliarTurn = ({
  familiar,
  then,
  dm,
  busy,
  showIdentity,
  at,
  children,
}: FamiliarTurnProps) => {
  const summary = useFamiliarSummary(familiar)
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
      {showIdentity ? (
        <FamiliarLink id={familiar} then={then} className="relative self-start">
          <PixelAvatar
            className={busy ? 'opacity-50 grayscale' : undefined}
            familiar={summary ?? { id: asId(familiar), name: then ?? '?' }}
          />
          {busy && (
            <span
              className="absolute -right-1 -bottom-1 grid size-3.5 place-items-center border border-background bg-muted text-muted-foreground"
              title="Busy"
            >
              <HourglassSpinner className="size-2.5" />
              <span className="sr-only">Busy</span>
            </span>
          )}
        </FamiliarLink>
      ) : (
        <span className="w-8 shrink-0" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {showIdentity && (
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
