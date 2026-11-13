import type { PageView, Subject } from '@familiar-ai/client'

export type MemoryNoteProps = {
  familiar: number
  note: PageView['notes'][number]
  subject: Subject
}
