import { cn } from 'cn'
import { PixelCharacter } from '@/components/pixel-character'
import { hueOf, imageUrl, portraitOf, usePortraitImages } from '@/lib/avatars'
import type { PixelAvatarProps } from './types'

/**
 * A Familiar's portrait, square and unframed, at whole multiples of 32px so
 * pixels stay whole: its generated character on a faint square, its initial
 * on its colour, or the owner's image. While it replies, a character bobs
 * and an image steps between its strip's two frames; reduced motion keeps
 * them still. A crop keeps the middle of the face.
 */
export const PixelAvatar = ({
  familiar,
  scale = 1,
  talking = false,
  crop = 'whole',
  className,
}: PixelAvatarProps) => {
  const portrait = portraitOf(familiar, usePortraitImages().names)
  const size = 32 * scale
  const width = crop === 'whole' ? size : size / 2
  const height = crop === 'quarter' ? size / 2 : size
  const offset = {
    marginLeft: crop === 'whole' ? 0 : -size / 4,
    marginTop: crop === 'quarter' ? -size / 4 : 0,
  }

  return (
    <span
      role="img"
      aria-label={talking ? `${familiar.name}, replying` : familiar.name}
      className={cn(
        'block shrink-0 overflow-hidden',
        portrait.kind === 'character' && 'bg-muted-foreground/15',
        className,
      )}
      style={{ width, height }}
    >
      {portrait.kind === 'character' ? (
        <PixelCharacter
          shape={portrait.shape}
          colour={portrait.colour}
          size={size}
          talking={talking}
          style={offset}
        />
      ) : portrait.kind === 'initial' ? (
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
          src={imageUrl(portrait.name)}
          alt=""
          width={size * 2}
          height={size}
          draggable={false}
          className={cn(
            'max-w-none [image-rendering:pixelated]',
            talking && 'animate-pixel-talk motion-reduce:animate-none',
          )}
          style={offset}
        />
      )}
    </span>
  )
}
