import type { TranscriptItem } from '@familiar-ai/client'
import type { Author } from '@familiar-ai/core'

export type TranscriptItemsProps = {
  items: TranscriptItem[]
  viewer: Author
}
