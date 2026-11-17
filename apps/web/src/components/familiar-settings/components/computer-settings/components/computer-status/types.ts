import type { FamiliarSummary } from '@familiar-ai/client'
import type { ComputerStatus } from '@/lib/computers'

export type ComputerStatusProps = {
  familiar: FamiliarSummary
  /** Undefined until it's first known. */
  status: ComputerStatus | undefined
  /** The last check's failure, if it failed. */
  error: Error | null
}
