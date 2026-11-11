import type { SettingsCategory } from '../../types'

export type CategoryBodyProps = {
  category: SettingsCategory
  /** Its own heading; a phone shows its label in the title bar instead. */
  heading?: boolean
}
