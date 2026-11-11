import type { ReactNode } from 'react'

export type ConnectionDrawerProps = {
  open: boolean
  onClose(): void
  title: string
  description: string
  /** A form, ending in a DrawerFooter. */
  children: ReactNode
}
