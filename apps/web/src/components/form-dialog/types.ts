import type { ReactNode } from 'react'

export type FormDialogProps = {
  title: string
  description: ReactNode
  canSubmit: boolean
  onSubmit: () => void
  onClose: () => void
  /** The form's fields. */
  children: ReactNode
}
