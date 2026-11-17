import type { FamiliarSummary } from '@familiar-ai/client'

export type GiveComputerProps = {
  familiar: FamiliarSummary
  /** Whether the host can run a computer for it. */
  provider: boolean
  /** Called with the pairing link when a machine is paired instead. */
  onPaired: (link: string) => void
}
