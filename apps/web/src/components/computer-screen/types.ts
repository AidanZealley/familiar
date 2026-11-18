import type { FamiliarSummary } from '@familiar-ai/client'
import type { Ref } from 'react'

export type ComputerScreenProps = {
  familiar: FamiliarSummary
  /** Full screen says more while asleep; small views say less. */
  size?: 'small' | 'large'
  /**
   * Whether it takes the mouse, keys and touches while this tab has
   * control. Default true; a preview that opens something when clicked
   * says false.
   */
  input?: boolean
  className?: string
  ref?: Ref<ScreenHandle>
}

/** Sends a key to the screen: pressed and released, or only `down` or up. */
export type SendKey = (
  keysym: number,
  code: string | null,
  down?: boolean,
) => void

/** What a shown screen lets its surroundings do: send keys while controlling. */
export type ScreenHandle = { sendKey: SendKey }
