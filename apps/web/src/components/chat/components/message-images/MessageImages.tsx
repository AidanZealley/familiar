import { cn } from 'cn'
import { useMemo, useState } from 'react'
import { imageSource } from '@/lib/images'
import { ImageViewer } from '../image-viewer'
import type { MessageImagesProps } from './types'

/**
 * A message's images, above its words: one shown large, several in two
 * columns. Each opens full size.
 */
export const MessageImages = ({ images }: MessageImagesProps) => {
  const sources = useMemo(() => images.map(imageSource), [images])
  // What's shown full size, kept after closing so it fades out with the
  // viewer rather than vanishing first.
  const [viewing, setViewing] = useState<{ source: string; open: boolean }>()
  const one = sources.length === 1

  return (
    <>
      <div
        className={cn(
          'grid gap-1',
          one ? 'max-w-[min(80%,24rem)]' : 'w-[min(80%,24rem)] grid-cols-2',
        )}
      >
        {sources.map((source, index) => (
          <button
            key={index}
            type="button"
            aria-label={`Open image ${index + 1}`}
            onClick={() => setViewing({ source, open: true })}
            className="block overflow-hidden ring-1 ring-foreground/10"
          >
            <img
              src={source}
              alt=""
              className={
                one ? 'max-h-72 w-auto' : 'aspect-square size-full object-cover'
              }
            />
          </button>
        ))}
      </div>
      <ImageViewer
        source={viewing?.source}
        open={!!viewing?.open}
        onClose={() =>
          setViewing((shown) => shown && { ...shown, open: false })
        }
      />
    </>
  )
}
