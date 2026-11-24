import type { FamiliarSummary } from '@familiar-ai/client'
import type { ComputerStatus } from '@familiar-ai/computer'

export type ComputerStatusProps = {
  familiar: FamiliarSummary
  /** Undefined until it's first known. */
  status: ComputerStatus | undefined
  /** The last check's failure, if it failed. */
  error: Error | null
}
