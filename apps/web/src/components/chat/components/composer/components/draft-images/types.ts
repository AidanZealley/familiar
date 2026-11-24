import type { OutgoingImage } from '@familiar-ai/client'

/**
 * An image attached to a draft: shown from `url` at once, sent once it's
 * `prepared` to fit (see `prepareImage`).
 */
export type DraftImage = {
  /**
   * An object URL of what was attached, unique to it, so also its identity;
   * revoked when it's removed or sent.
   */
  url: string
  prepared?: OutgoingImage
}

export type DraftImagesProps = {
  images: readonly DraftImage[]
  onRemove(url: string): void
}
