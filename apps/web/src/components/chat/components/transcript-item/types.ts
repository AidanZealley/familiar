import type { TranscriptItem } from '@familiar-ai/client'
import type { RunHead } from '../transcript-items/layout'

export type TranscriptItemProps = {
  item: TranscriptItem
  /** A DM's: no portraits or names, nor the gutter they take. */
  dm: boolean
  /** Set on the first item of a run of one Familiar's turn items. */
  run?: RunHead
  /** Set on the run's last item. */
  end?: RunHead
}
