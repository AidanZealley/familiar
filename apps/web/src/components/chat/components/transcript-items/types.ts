import type { TranscriptItem } from '@familiar-ai/client'

export type TranscriptItemsProps = {
  items: readonly TranscriptItem[]
  /** A DM's, whose Familiar goes unnamed beside its replies. */
  dm: boolean
  /** A named room's lead, whose portrait wears a crown. */
  lead?: number
}
