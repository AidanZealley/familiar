import type { ReactNode } from 'react'

export type ComposerNoticeProps = {
  /** An error, as an alert; or how the draft will go, as a status. */
  tone: 'error' | 'note'
  children: ReactNode
}
