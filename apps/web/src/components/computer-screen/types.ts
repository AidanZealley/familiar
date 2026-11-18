import type { FamiliarSummary } from '@familiar-ai/client'

export type ComputerScreenProps = {
  familiar: FamiliarSummary
  /** Full screen says more while asleep; small views say less. */
  size?: 'small' | 'large'
  /**
   * Whether it takes the mouse, keys and touches while this tab has
   * control. Default true; a preview that opens something when clicked
   * says false.
   */
  input?: boolean
  className?: string
}
