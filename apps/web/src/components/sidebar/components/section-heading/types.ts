import type { Icon } from '@phosphor-icons/react'

export type SectionHeadingProps = {
  icon: Icon
  label: string
  /** Names the add button for screen readers and its tooltip. */
  addLabel: string
  onAdd(): void
}
