import type { FamiliarSummary } from '@familiar-ai/client'

export type PixelAvatarProps = {
  familiar: Pick<FamiliarSummary, 'id' | 'name' | 'avatar'>
  /** Whole multiples of 32px only, so every source pixel stays whole. */
  scale?: 1 | 2 | 3
  /** Its Familiar is replying in the open room: the portrait talks. */
  talking?: boolean
  /**
   * How much of the face shows, from its middle: all of it, a column half
   * as wide, or a square half as wide and tall, for a room's grouped
   * portrait.
   */
  crop?: 'whole' | 'half' | 'quarter'
  className?: string
}
