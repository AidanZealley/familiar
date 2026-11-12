import type { FamiliarSummary } from '@familiar-ai/client'

export type PortraitOptionProps = {
  familiar: Pick<FamiliarSummary, 'id' | 'name'>
  /** The `avatar` this option stores; null for the one its ID gives. */
  avatar: string | null
  selected: boolean
  onSelect(): void
  /** Its name, for screen readers and as a tooltip. */
  name: string
}
