import type { FamiliarSummary } from '@familiar-ai/client'
import type { NamedRoom } from '@/lib/workspace'

export type RoomRowProps = {
  room: NamedRoom
  familiars: readonly FamiliarSummary[]
}
