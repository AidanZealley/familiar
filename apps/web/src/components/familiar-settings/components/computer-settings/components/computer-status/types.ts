import type { FamiliarSummary } from '@familiar-ai/client'
import type { Computer } from '@/lib/computers'

export type ComputerStatusProps = {
  familiar: FamiliarSummary
  /** A computer it has: its status is anything but none. */
  computer: Computer
}
