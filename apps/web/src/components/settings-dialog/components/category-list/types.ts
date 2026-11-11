import type { SettingsGroup } from '../../types'

export type CategoryListProps = {
  groups: SettingsGroup[]
  /** The category shown beside the list, on a wide screen. */
  current?: string
  onShow(id: string): void
}
