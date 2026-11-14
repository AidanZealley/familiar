import type { FamiliarSummary, RoomSummary } from '@familiar-ai/client'

export type ReplyingFaceProps = {
  familiar: FamiliarSummary
  /** Where it's replying. */
  room: RoomSummary
}
