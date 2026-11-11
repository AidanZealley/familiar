import type { TranscriptItem } from '@familiar-ai/client'

export type RoomNoteProps = {
  note: Extract<TranscriptItem, { type: 'note' }>
}
