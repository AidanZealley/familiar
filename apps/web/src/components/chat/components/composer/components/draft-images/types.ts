/**
 * An image attached to a draft: shown from its `file` at once, and uploaded
 * under its `id` in the outbox, which says how far the upload has got.
 */
export type DraftImage = {
  /** Its identity, as `nextId` gives it, and its upload's key. */
  id: number
  file: File
}

export type DraftImagesProps = {
  images: readonly DraftImage[]
  /** Offers to try a failed upload again. */
  onRetry?: (image: DraftImage) => void
  /** Offers a × on each, to remove it. */
  onRemove?: (id: number) => void
}
