import type { FamiliarSummary, RoomSummary } from '@familiar-ai/client'
import type { Icon } from '@phosphor-icons/react'

export type WaitingSectionProps = {
  /** Names the section; shown as a heading, as the sidebar's, with `icon`. */
  label: string
  icon?: Icon
  rooms: readonly RoomSummary[]
  familiars: readonly FamiliarSummary[]
  /** DMs as a centred grid of faces; rooms as a list, where the name matters more. */
  layout: 'grid' | 'list'
}
