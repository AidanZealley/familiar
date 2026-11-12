import type { FamiliarSummary, RoomSummary } from '@familiar-ai/client'

export type WaitingFaceProps = {
  room: RoomSummary
  familiars: readonly FamiliarSummary[]
}
