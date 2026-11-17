import type { FamiliarSummary } from '@familiar-ai/client'

export type RemoveComputerProps = {
  familiar: FamiliarSummary
  /** Whether the host runs it, so removing it deletes its disk. */
  provided: boolean
  disabled: boolean
  onRemove: () => void
}
