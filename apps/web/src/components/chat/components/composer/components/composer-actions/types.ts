import type { RoomSummary } from '@familiar-ai/client'

export type ComposerActionsProps = {
  room: RoomSummary
  /** The draft goes as a note. */
  note: boolean
  /** The draft has images, which a note can't carry. */
  hasImages: boolean
  /** Send is offered and can be pressed. */
  sendable: boolean
  /** Stop is offered in place of Send. */
  showStop: boolean
  onAttach(files: File[]): void
  onMention(): void
  onToggleNote(): void
  onStop(): void
}
