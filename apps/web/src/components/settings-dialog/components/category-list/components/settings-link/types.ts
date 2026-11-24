import type { ComponentProps } from 'react'
import type { SettingsItem } from '../../../../types'

export type SettingsLinkProps = ComponentProps<'button'> & {
  item: SettingsItem
}
