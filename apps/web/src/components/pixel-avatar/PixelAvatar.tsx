import { cn } from 'cn'
import { useState } from 'react'
import { avatarOf, hueOf } from '@/lib/avatars'
import type { PixelAvatarProps } from './types'

/**
 * A Familiar's pixel portrait: square, unframed, its art drawn pixelated at
 * whole multiples of 32px. While it talks, it steps between its strip's two
 * frames; reduced motion keeps it still. Without its file, its initial on
 * its colour.
 */
export const PixelAvatar = ({
  familiar,
  scale = 1,
  talking = false,
  half = false,
  className,
}: PixelAvatarProps) => {
  const src = avatarOf(familiar)
  const [missing, setMissing] = useState<string>()
  const size = 32 * scale
  const width = half ? size / 2 : size

  return (
    <span
      role="img"
      aria-label={talking ? `${familiar.name}, replying` : familiar.name}
      className={cn('block shrink-0 overflow-hidden', className)}
      style={{ width, height: size }}
    >
      {missing === src ? (
        <span
          aria-hidden
          className="grid size-full place-items-center font-heading font-medium text-neutral-900 uppercase"
          style={{ background: hueOf(familiar), fontSize: size / 2 }}
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
          onError={() => setMissing(src)}
          className={cn(
            'max-w-none [image-rendering:pixelated]',
            talking && 'animate-pixel-talk motion-reduce:animate-none',
          )}
          style={half ? { marginLeft: -size / 4 } : undefined}
        />
      )}
    </span>
  )
}
