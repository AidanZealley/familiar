import { cn } from 'cn'
import { useState } from 'react'
import { ImageViewer } from '../image-viewer'
import { MessageImage } from './components/message-image'
import type { MessageImagesProps } from './types'

/**
 * A message's images, above its words: one shown large, several in two
 * columns. Each opens full size.
 */
export const MessageImages = ({ images }: MessageImagesProps) => {
  // What's shown full size, kept after closing so it fades out with the
  // viewer rather than vanishing first.
  const [viewing, setViewing] = useState<{ source: string; open: boolean }>()
  const alone = images.length === 1

  return (
    <>
      <div
        className={cn(
          'grid gap-1',
          alone ? 'max-w-[min(80%,24rem)]' : 'w-[min(80%,24rem)] grid-cols-2',
        )}
      >
        {images.map((image, index) => (
          <MessageImage
            key={index}
            image={image}
            index={index}
            alone={alone}
            onOpen={(source) => setViewing({ source, open: true })}
          />
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
