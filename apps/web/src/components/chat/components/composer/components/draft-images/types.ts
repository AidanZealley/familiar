import type { ImageProblem, OutgoingImage } from '@familiar-ai/client'

/**
 * An image attached to a draft: shown from its `file` at once, sent once
 * it's `prepared` to fit (see `prepareImage`), and marked with the
 * `problem` core gave when it refused it in a send that failed.
 */
export type DraftImage = {
  /** Its identity, as `nextId` gives it. */
  id: number
  file: File
  prepared?: OutgoingImage
  problem?: ImageProblem
}

export type DraftImagesProps = {
  images: readonly DraftImage[]
  onRemove(id: number): void
}
