import type { FamiliarSummary, RoomSummary } from '@familiar-ai/client'

export type FamiliarRowProps = {
  familiar: FamiliarSummary
  /** Its DM, once opened. */
  dm: RoomSummary | undefined
}
