import { cn } from 'cn'
import { avatarOf, hueOf, usePortraits } from '@/lib/avatars'
import type { PixelAvatarProps } from './types'

/**
 * A Familiar's pixel portrait: square, unframed, its art drawn pixelated at
 * whole multiples of 32px. While it talks, it steps between its strip's two
 * frames; reduced motion keeps it still. Without portraits, its initial on
 * its colour. A crop keeps the middle of the face, so pixels stay whole.
 */
export const PixelAvatar = ({
  familiar,
  scale = 1,
  talking = false,
  crop = 'whole',
  className,
}: PixelAvatarProps) => {
  const src = avatarOf(familiar, usePortraits())
  const size = 32 * scale
  const width = crop === 'whole' ? size : size / 2
  const height = crop === 'quarter' ? size / 2 : size

  return (
    <span
      role="img"
      aria-label={talking ? `${familiar.name}, replying` : familiar.name}
      className={cn('block shrink-0 overflow-hidden', className)}
      style={{ width, height }}
    >
      {!src ? (
        <span
          aria-hidden
          className="grid size-full place-items-center font-heading font-medium text-neutral-900 uppercase"
          style={{
            background: hueOf(familiar),
            fontSize: Math.min(width, height) / 2,
          }}
        >
          {familiar.name.slice(0, 1)}
        </span>
      ) : (
        <img
          src={src}
          alt=""
          width={size * 2}
          height={size}
          draggable={false}
          className={cn(
            'max-w-none [image-rendering:pixelated]',
            talking && 'animate-pixel-talk motion-reduce:animate-none',
          )}
          style={{
            marginLeft: crop === 'whole' ? 0 : -size / 4,
            marginTop: crop === 'quarter' ? -size / 4 : 0,
          }}
        />
      )}
    </span>
  )
}
