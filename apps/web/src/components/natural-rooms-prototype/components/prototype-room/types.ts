import type { Frame, Member } from '../../timeline'

export type ReplyingVariant = 'A' | 'B' | 'C'
export type QueuedVariant = 'A' | 'B'

export type PrototypeRoomProps = {
  frame: Frame
  members: readonly Member[]
  replying: ReplyingVariant
  queued: QueuedVariant
  /** A short caption over the room, when several are shown side by side. */
  caption?: string
}
