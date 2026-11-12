import type { FamiliarSummary, RoomSummary } from '@familiar-ai/client'
import type { Icon } from '@phosphor-icons/react'

export type WaitingSectionProps = {
  icon: Icon
  label: string
  rooms: readonly RoomSummary[]
  familiars: readonly FamiliarSummary[]
  /** DMs as a grid of faces; rooms as a list, where the name matters more. */
  layout: 'grid' | 'list'
}
