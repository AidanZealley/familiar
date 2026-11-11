import type { FamiliarSummary } from '@familiar-ai/client'

export type AvatarPickerProps = {
  familiar: Pick<FamiliarSummary, 'id' | 'name'>
  /** The chosen portrait, such as `042`; null for the one its ID derives. */
  value: string | null
  onChange(value: string | null): void
}
