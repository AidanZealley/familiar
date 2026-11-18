import type { FamiliarSummary } from '@familiar-ai/client'
import type { SendKey } from '@/components/computer-screen'

export type ScreenControlsProps = {
  familiar: FamiliarSummary
  /** Whether this tab has control, so keys reach the screen. */
  controlling: boolean
  sendKey: SendKey
  /** Changing it plays Take over's attention animation once. */
  attention: number
}
