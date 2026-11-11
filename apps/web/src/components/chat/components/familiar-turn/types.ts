import type { ReactNode } from 'react'
import type { RunHead } from '../transcript-items/layout'

export type FamiliarTurnProps = {
  familiar: number
  /** Its name when it replied, for a Familiar since removed. */
  then?: string
  /** Set on a run's first item, which shows the portrait, name and time. */
  run?: RunHead
  children: ReactNode
}
