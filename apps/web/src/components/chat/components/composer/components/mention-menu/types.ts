import type { FamiliarSummary } from '@familiar-ai/client'

export type MentionMenuProps = {
  /** The room's Familiars whose names start with what's typed after `@`. */
  familiars: readonly FamiliarSummary[]
  onPick(familiar: FamiliarSummary): void
}
