import type { ReactNode } from 'react'

export type FamiliarTurnProps = {
  familiar: number
  /** Its name when it replied, for a Familiar since removed. */
  then?: string
  /** In a DM: no portrait or name, and the time under the run. */
  dm: boolean
  busy?: boolean
  /** Show the portrait and name at the start of a room turn. */
  showIdentity?: boolean
  /** When the turn finished, if shown on this item. */
  at?: number
  children: ReactNode
}
