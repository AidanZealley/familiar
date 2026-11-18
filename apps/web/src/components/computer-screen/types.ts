import type { FamiliarSummary } from '@familiar-ai/client'

export type ComputerScreenProps = {
  familiar: FamiliarSummary
  /** Full screen says more while asleep; small views say less. */
  size?: 'small' | 'large'
  className?: string
}
