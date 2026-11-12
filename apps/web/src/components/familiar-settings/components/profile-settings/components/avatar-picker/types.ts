import type { FamiliarSummary } from '@familiar-ai/client'

export type AvatarPickerProps = {
  familiar: Pick<FamiliarSummary, 'id' | 'name'>
  /** The owner's portraits, by name. */
  portraits: string[]
  /** The chosen portrait, by its name; null for the one its ID derives. */
  value: string | null
  onChange(value: string | null): void
}
