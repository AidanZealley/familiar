import type { TranscriptItem } from '@familiar-ai/client'
import type { Author } from '@familiar-ai/core'

export type TranscriptItemProps = {
  item: TranscriptItem
  /** The person sending, whose own messages sit on the right. */
  viewer: Author
  /** Follows another reply, so it needs no name of its own. */
  continued: boolean
}
