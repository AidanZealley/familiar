import type { FamiliarSummary } from '@familiar-ai/client'

export type GiveComputerProps = {
  familiar: FamiliarSummary
  /** Whether the host can run a computer for it. */
  provider: boolean
  /** Whether a request to give or remove a computer is still running. */
  pending: boolean
  /** Why the last request failed. */
  error?: string
  /** Gives it a computer the host runs, or a machine to pair. */
  onGive: (action: 'provide' | 'pair') => void
}
