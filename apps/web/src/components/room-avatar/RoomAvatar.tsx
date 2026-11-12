import { cn } from 'cn'
import { useMemo } from 'react'
import { PixelAvatar } from '@/components/pixel-avatar'
import { liveOf, nameOf, useFamiliars } from '@/lib/workspace'
import type { RoomAvatarProps } from './types'

/**
 * A room in one 32px square: its lead, then its members in the order they
 * joined. One fills it, two share it side by side, and with more the first
 * takes the left half, the second the top right, and a count of the rest
 * the bottom right. Faces are cropped rather than shrunk, so pixels stay
 * whole, and talk while they reply.
 */
export const RoomAvatar = ({ room, className }: RoomAvatarProps) => {
  const familiars = useFamiliars()
  const talking = useMemo(() => liveOf(room.turns).running, [room.turns])
  const ids = room.familiars.toSorted(
    (a, b) => Number(b === room.lead) - Number(a === room.lead),
  )
  const members = ids.flatMap((id) => familiars.find((f) => f.id === id) ?? [])
  const [first, second] = members
  const rest = members.length - 2
  const face = (
    familiar: (typeof members)[number],
    crop: 'whole' | 'half' | 'quarter',
    className?: string,
  ) => (
    <PixelAvatar
      key={familiar.id}
      familiar={familiar}
      crop={crop}
      talking={talking.includes(familiar.id)}
      className={className}
    />
  )

  return (
    <span
      role="img"
      aria-label={ids.map((id) => nameOf(familiars, id)).join(', ')}
      className={cn('flex size-8 shrink-0 bg-muted', className)}
    >
      {first && !second && face(first, 'whole')}
      {first && second && rest === 0 && (
        <>
          {face(first, 'half')}
          {face(second, 'half', 'border-l border-background')}
        </>
      )}
      {first && second && rest > 0 && (
        <>
          {face(first, 'half')}
          <span className="flex flex-col border-l border-background">
            {face(second, 'quarter')}
            <span
              aria-hidden
              className="grid size-4 place-items-center border-t border-background bg-muted font-heading text-[9px] leading-none font-medium text-foreground tabular-nums"
            >
              +{rest}
            </span>
          </span>
        </>
      )}
    </span>
  )
}
