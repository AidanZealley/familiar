import type { RoomSummary } from '@familiar-ai/client'

export type ComposerProps = {
  /** The open room: who can be mentioned, and whether it takes messages. */
  room: RoomSummary
  /** A Familiar is replying; offer Stop instead of Send when the input is empty. */
  busy: boolean
}
