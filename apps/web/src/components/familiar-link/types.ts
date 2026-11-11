import type { ReactNode } from 'react'

export type FamiliarLinkProps = {
  /** The Familiar whose settings it opens. */
  id: number
  /** What to call it once removed: the name it had then. */
  then?: string
  /** In place of its name, such as its portrait. */
  children?: ReactNode
  className?: string
}
