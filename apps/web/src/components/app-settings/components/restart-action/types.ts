import type { ReactElement } from 'react'
import type { UpdateInfo } from '@/lib/updates'

export type RestartActionProps = {
  /** The settings list's link, which opens the confirmation. */
  link: ReactElement
  info: UpdateInfo
}
