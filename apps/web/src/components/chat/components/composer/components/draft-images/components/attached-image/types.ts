import type { DraftImage } from '../../types'

export type AttachedImageProps = {
  image: DraftImage
  /** Its place among the draft's images, from 0. */
  index: number
  onRemove?: () => void
}
