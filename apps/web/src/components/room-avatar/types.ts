import type { FamiliarSummary } from '@familiar-ai/client'

export type RoomAvatarProps = {
  /** The room's members, in order; the first two show. */
  members: readonly FamiliarSummary[]
  className?: string
}
