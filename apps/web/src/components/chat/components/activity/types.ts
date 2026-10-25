import type { ReactNode } from 'react'

export type ActivityProps = {
  icon: ReactNode
  label: ReactNode
  /** Still going: the label shimmers. */
  active?: boolean
  failed?: boolean
  /** Shown when expanded. */
  children: ReactNode
}
