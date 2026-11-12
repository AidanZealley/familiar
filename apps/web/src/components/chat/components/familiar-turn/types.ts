import type { ReactNode } from 'react'
import type { RunHead } from '../transcript-items/layout'

export type FamiliarTurnProps = {
  familiar: number
  /** Its name when it replied, for a Familiar since removed. */
  then?: string
  /** In a DM: no portrait or name, and the time under the run. */
  dm: boolean
  /** It leads the room: its portrait wears a star. */
  lead?: boolean
  /** Set on a run's first item, which shows the portrait, name and time. */
  run?: RunHead
  /** Set on a run's last item, under which a DM shows the time. */
  end?: RunHead
  children: ReactNode
}
