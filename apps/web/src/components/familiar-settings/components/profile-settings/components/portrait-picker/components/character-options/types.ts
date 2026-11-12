import type { FamiliarSummary } from '@familiar-ai/client'
import type { Portrait } from '@/lib/avatars'

export type CharacterOptionsProps = {
  familiar: Pick<FamiliarSummary, 'id' | 'name'>
  /** The draft's portrait, which may not be a character yet. */
  portrait: Portrait
  onChange(value: string | null): void
}
