import type { FamiliarSummary, RoomSummary } from '@familiar-ai/client'
import type { Icon } from '@phosphor-icons/react'

export type WaitingSectionProps = {
  icon: Icon
  label: string
  rooms: readonly RoomSummary[]
  familiars: readonly FamiliarSummary[]
}
