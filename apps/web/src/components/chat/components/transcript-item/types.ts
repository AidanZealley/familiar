import type { TranscriptItem } from '@familiar-ai/client'
import type { RunHead } from '../transcript-items/layout'

export type TranscriptItemProps = {
  item: TranscriptItem
  /** Set on the first item of a run of one Familiar's turn items. */
  run?: RunHead
}
