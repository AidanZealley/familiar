import type { OutgoingImage } from '@familiar-ai/client'

/**
 * An image attached to a draft: shown from its `file` at once, and sent
 * once it's `prepared` to fit (see `prepareImage`).
 */
export type DraftImage = {
  /** Its identity, as `nextId` gives it. */
  id: number
  file: File
  prepared?: OutgoingImage
}

export type DraftImagesProps = {
  images: readonly DraftImage[]
  /** Offers a × on each, to remove it. */
  onRemove?: (id: number) => void
}
