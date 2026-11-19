import type { Member, Turn } from '../../timeline'

export type PrototypeHeaderProps = {
  title: string
  members: readonly Member[]
  turns: readonly Turn[]
  /**
   * Variant C shows each member's whole portrait, talking while it replies,
   * in place of the room's grouped portrait.
   */
  faces: boolean
}
