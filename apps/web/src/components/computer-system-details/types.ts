import type { FamiliarSummary } from '@familiar-ai/client'
import type { ComputerStatus } from '@/lib/computers'

export type ComputerSystemDetailsProps = {
  familiar: FamiliarSummary
  /** Its state from a status poll, until the details say. */
  status?: ComputerStatus
}
