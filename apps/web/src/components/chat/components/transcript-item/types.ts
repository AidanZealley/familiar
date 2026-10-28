import type { TranscriptItem } from '@familiar/client'

export type TranscriptItemProps = {
  item: TranscriptItem
  /** When its turn was answered, if it's the turn's last reply. */
  time?: number
}
