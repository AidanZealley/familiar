import type { Icon } from '@phosphor-icons/react'
import type { ReactElement, ReactNode } from 'react'

/** What the list shows for a category or an action. */
export type SettingsItem = {
  /** What an opener names to show it first; unique among the items. */
  id: string
  label: string
  icon: Icon
  /** Words the search matches beyond the label, such as `theme dark`. */
  keywords?: string
  /** Beside the label, such as how many connections need you. */
  badge?: ReactNode
  /** Destructive, in the danger colour. */
  danger?: boolean
}

export type SettingsCategory = SettingsItem & {
  description?: ReactNode
  content: ReactNode
}

/**
 * An item that does something rather than showing a page, such as opening
 * a confirmation: `render` gets the item's link, to render as its trigger.
 */
export type SettingsAction = SettingsItem & {
  render(link: ReactElement): ReactNode
}

export type SettingsGroup = {
  label?: string
  categories?: SettingsCategory[]
  /** After the categories. */
  actions?: SettingsAction[]
}

export type SettingsDialogProps = {
  title: string
  /** Beside the title: a portrait, or a room's faces. */
  media?: ReactNode
  groups: SettingsGroup[]
}
