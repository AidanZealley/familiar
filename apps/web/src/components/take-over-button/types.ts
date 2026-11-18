import type { FamiliarSummary } from '@familiar-ai/client'

export type TakeOverButtonProps = {
  familiar: FamiliarSummary
  /** Just the icon, with its words as its label, for a small bar. */
  iconOnly?: boolean
  /** Changing it plays the button's attention animation once. */
  attention?: number
  className?: string
}
