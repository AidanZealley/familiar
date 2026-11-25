import type { DraftImage } from '@/lib/outbox'

export type DraftImagesProps = {
  images: readonly DraftImage[]
  /** Offers to try a failed upload again. */
  onRetry?: (image: DraftImage) => void
  /** Offers a × on each, to remove it. */
  onRemove?: (id: number) => void
  className?: string
}
