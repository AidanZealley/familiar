import { ImageBrokenIcon } from '@phosphor-icons/react'
import { useRoomStore } from '@familiar-ai/client/react'
import { cn } from 'cn'
import { useState } from 'react'
import type { MessageImageProps } from './types'

/**
 * One of a message's images, loaded from the room by its ID. Its box is
 * sized from the stored dimensions before it loads, so the transcript
 * doesn't jump, with a muted fill meanwhile: alone, as wide as fits the
 * column and 18rem of height at its shape, never wider than it is; in a
 * grid, a square cell. One that can't be shown, such as an image kept
 * inline before images were stored apart, is a square saying so.
 */
export const MessageImage = ({
  image,
  index,
  alone,
  onOpen,
}: MessageImageProps) => {
  const store = useRoomStore()
  const [broken, setBroken] = useState(false)

  if ('unavailable' in image || broken) {
    return (
      <div
        className={cn(
          'grid aspect-square place-items-center gap-1 bg-muted p-2 text-center text-xs text-muted-foreground ring-1 ring-foreground/10',
          alone && 'w-40',
        )}
      >
        <ImageBrokenIcon className="size-5" />
        Image unavailable
      </div>
    )
  }
  const source = store.imageUrl(image.id)
  return (
    <button
      type="button"
      aria-label={`Open image ${index + 1}`}
      onClick={() => onOpen(source)}
      className="block overflow-hidden bg-muted ring-1 ring-foreground/10"
      style={
        alone
          ? {
              width: `min(100%, ${image.width}px, calc(18rem * ${image.width} / ${image.height}))`,
            }
          : undefined
      }
    >
      <img
        src={source}
        width={image.width}
        height={image.height}
        loading="lazy"
        alt=""
        onError={() => setBroken(true)}
        // With its width set and its height auto, the browser takes the
        // shape from `width` and `height` before the image arrives.
        className={
          alone ? 'block h-auto w-full' : 'aspect-square size-full object-cover'
        }
      />
    </button>
  )
}
