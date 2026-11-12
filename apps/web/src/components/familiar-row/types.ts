import type { FamiliarSummary, RoomSummary } from '@familiar-ai/client'

export type FamiliarRowProps = {
  familiar: FamiliarSummary
  /** Its DM, once opened. */
  dm: RoomSummary | undefined
  /** Lets the latest entry run to three lines, as a catch-up shows it. */
  wrap?: boolean
}
