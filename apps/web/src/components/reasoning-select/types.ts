import type { ModelThinkingLevel } from '@familiar-ai/client'

export type ReasoningSelectProps = {
  /** The levels the model supports. */
  levels: ModelThinkingLevel[]
  value: ModelThinkingLevel
  /** The level it runs at unless one is picked, marked "Default". */
  defaultLevel: ModelThinkingLevel
  onChange: (level: ModelThinkingLevel) => void
  /**
   * In the composer's toolbar, opening upwards, or in settings, opening
   * downwards.
   */
  place?: 'composer' | 'settings'
  disabled?: boolean
}
