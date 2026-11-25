import { ImageBrokenIcon } from '@phosphor-icons/react'
import { useRoomStore } from '@familiar-ai/client/react'
import { cn } from 'cn'
import { useState } from 'react'
import type { MessageImageProps } from './types'

/**
 * One of a message's images, loaded from the room by its ID. Its box has
 * the image's shape before it loads, so the transcript doesn't jump, with
 * a muted fill meanwhile. One that can't be shown, such as an image kept
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
    >
      <img
        src={source}
        width={image.width}
        height={image.height}
        loading="lazy"
        alt=""
        onError={() => setBroken(true)}
        className={
          alone
            ? 'h-auto max-h-72 w-auto'
            : 'aspect-square size-full object-cover'
        }
      />
    </button>
  )
}
