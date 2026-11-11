import type { FamiliarSummary } from '@familiar-ai/client'

export type PixelAvatarProps = {
  familiar: Pick<FamiliarSummary, 'id' | 'name' | 'avatar'>
  /** Whole multiples of 32px only, so every source pixel stays whole. */
  scale?: 1 | 2 | 3
  /** Its Familiar is replying in the open room: the portrait talks. */
  talking?: boolean
  /** Only the middle half of the face, for two side by side in a room's. */
  half?: boolean
  className?: string
}
