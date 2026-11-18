import type { FamiliarSummary } from '@familiar-ai/client'

export type TakeOverButtonProps = {
  familiar: FamiliarSummary
  /** Changing it plays the button's attention animation once. */
  attention?: number
  className?: string
}
