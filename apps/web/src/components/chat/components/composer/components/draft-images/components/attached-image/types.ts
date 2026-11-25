import type { DraftImage } from '../../types'

export type AttachedImageProps = {
  image: DraftImage
  /** Its place among the draft's images, from 0. */
  index: number
  /** Offers to try its upload again, once it has failed. */
  onRetry?: () => void
  onRemove?: () => void
}
