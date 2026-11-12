import { NoteIcon } from '@phosphor-icons/react'
import type { RoomNoteProps } from './types'

/** A host's note: context for the room's Familiars, which no one replies to. */
export const RoomNote = ({ note }: RoomNoteProps) => (
  <div className="flex items-start gap-2 border border-dashed bg-muted/40 px-3 py-2 text-xs">
    <NoteIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
    <p className="min-w-0 whitespace-pre-wrap">
      <span className="font-medium">Note</span>
      <br />
      {note.text}
    </p>
  </div>
)
