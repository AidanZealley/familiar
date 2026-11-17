import type { FamiliarSummary } from '@familiar-ai/client'
import type { ComputerStatus } from '@/lib/computers'

export type GiveComputerProps = {
  familiar: FamiliarSummary
  /** Its host's report, which says when computers are unavailable. */
  status: ComputerStatus | undefined
  disabled: boolean
  error: string | undefined
  onGive: () => void
}
