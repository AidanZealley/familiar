import type { FamiliarSummary, RoomSummary } from '@familiar-ai/client'

export type WaitingFaceProps = {
  room: RoomSummary
  familiars: readonly FamiliarSummary[]
  /** A tile, face over name, or a row, face beside name and count after. */
  layout: 'tile' | 'row'
}
