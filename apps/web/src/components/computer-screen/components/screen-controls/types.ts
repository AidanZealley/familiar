import type { FamiliarSummary } from '@familiar-ai/client'

/** Sends a key to the screen: pressed and released, or only `down` or up. */
export type SendKey = (
  keysym: number,
  code: string | null,
  down?: boolean,
) => void

export type ScreenControlsProps = {
  familiar: FamiliarSummary
  /** Whether this tab has control, so keys reach the screen. */
  controlling: boolean
  sendKey: SendKey
  /** Changing it plays Take over's attention animation once. */
  attention: number
}
