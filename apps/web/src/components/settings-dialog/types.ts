import type { Icon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'

export type SettingsCategory = {
  /** What an opener names to show it first. */
  id: string
  label: string
  icon: Icon
  description?: ReactNode
  /** Words the search matches beyond the label, such as `theme dark`. */
  keywords?: string
  /** Beside the label, such as how many connections need you. */
  badge?: ReactNode
  /** Destructive, in the danger colour. */
  danger?: boolean
  content: ReactNode
}

export type SettingsGroup = { label?: string; categories: SettingsCategory[] }

export type SettingsDialogProps = {
  title: string
  /** Beside the title: a portrait, or a room's faces. */
  media?: ReactNode
  groups: SettingsGroup[]
}
