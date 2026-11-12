import type { FamiliarSummary } from '@familiar-ai/client'

export type PortraitPickerProps = {
  familiar: Pick<FamiliarSummary, 'id' | 'name' | 'avatar'>
  /** The draft `avatar`: null for the character its ID generates. */
  value: string | null
  onChange(value: string | null): void
}
