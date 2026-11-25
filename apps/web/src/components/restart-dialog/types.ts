import type { ReactElement } from 'react'
import type { UpdateInfo } from '@/lib/updates'

export type RestartDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  info: UpdateInfo
  /** Why to restart, said before the dialog asks. */
  description: string
  /** What opens it, if anything does besides `open`. */
  trigger?: ReactElement
  /** The button that closes it without restarting. */
  cancelLabel?: string
}
