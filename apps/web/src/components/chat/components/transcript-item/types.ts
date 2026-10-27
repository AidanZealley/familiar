import type { TranscriptItem } from '@familiar/client'
import type { Margin } from '../../margins'

export type TranscriptItemProps = {
  item: TranscriptItem
  /** Its time and saved facts, if it has a margin. */
  margin?: Margin
}
