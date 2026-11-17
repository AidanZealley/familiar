import type { ReactNode } from 'react'

export type FormDialogProps = {
  title: string
  description: ReactNode
  canSubmit: boolean
  /** The submit button's label. Default "Create". */
  submitLabel?: string
  onSubmit: () => void
  onClose: () => void
  /** The form's fields. */
  children: ReactNode
}
