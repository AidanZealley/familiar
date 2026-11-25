import type { TranscriptImage } from '@familiar-ai/client'

export type MessageImageProps = {
  image: TranscriptImage
  /** Its place among the message's images, from 0. */
  index: number
  /** The only image: shown at its own shape rather than a square. */
  alone: boolean
  /** Opens it full size, from where it loads. */
  onOpen: (source: string) => void
}
