import type { FamiliarSummary } from '@familiar-ai/client'
import type { NamedRoom } from '@/lib/workspace'

export type ArchivedRoomsProps = {
  rooms: readonly NamedRoom[]
  familiars: readonly FamiliarSummary[]
}
