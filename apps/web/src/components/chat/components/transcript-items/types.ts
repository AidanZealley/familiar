import type { RoomTurn, TranscriptItem } from '@familiar-ai/client'

export type TranscriptItemsProps = {
  turns: readonly RoomTurn[]
  items: readonly TranscriptItem[]
  /** A DM's, whose Familiar goes unnamed beside its replies. */
  dm: boolean
}
