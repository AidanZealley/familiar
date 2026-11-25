import type { RoomSummary } from '@familiar-ai/client'
import type { RefObject } from 'react'
import type { Drafting } from './useDraft'

export type ComposerProps = {
  /** The open room: who can be mentioned, and whether it takes messages. */
  room: RoomSummary
  /** A Familiar is replying; offer Stop instead of Send when the input is empty. */
  busy: boolean
  /** The room's draft, which the chat owns. */
  drafting: Drafting
  /** The text input, which the chat focuses to edit a failed send. */
  input: RefObject<HTMLTextAreaElement | null>
}
