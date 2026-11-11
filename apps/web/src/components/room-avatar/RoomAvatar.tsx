import { cn } from 'cn'
import { PixelAvatar } from '@/components/pixel-avatar'
import type { RoomAvatarProps } from './types'

/**
 * A room as its first two members: the middle of each face, side by side
 * in one 32px square, cropped rather than shrunk so pixels stay whole.
 */
export const RoomAvatar = ({
  members,
  talking = [],
  className,
}: RoomAvatarProps) => {
  const faces = members.slice(0, 2)

  return (
    <span
      role="img"
      aria-label={faces.map((familiar) => familiar.name).join(' and ')}
      className={cn('flex size-8 shrink-0 bg-muted', className)}
    >
      {faces.map((familiar, index) => (
        <PixelAvatar
          key={familiar.id}
          familiar={familiar}
          half={faces.length === 2}
          talking={talking.includes(familiar.id)}
          className={cn(index === 1 && 'border-l border-background')}
        />
      ))}
    </span>
  )
}
