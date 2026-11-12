import type { FamiliarSummary } from '@familiar-ai/client'
import type { NamedRoom } from '@/lib/workspace'

export type RoomRowProps = {
  room: NamedRoom
  familiars: readonly FamiliarSummary[]
  /** Lets the latest entry run to three lines, as a catch-up shows it. */
  wrap?: boolean
  className?: string
}
