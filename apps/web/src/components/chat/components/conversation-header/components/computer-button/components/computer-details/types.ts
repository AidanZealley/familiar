import type { FamiliarSummary } from '@familiar-ai/client'
import type { ComputerStatus } from '@familiar-ai/computer'

export type ComputerDetailsProps = {
  familiar: FamiliarSummary
  /** Its state from the header's poll, until the details arrive. */
  status?: ComputerStatus
}
