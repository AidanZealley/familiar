import { useQuery } from '@tanstack/react-query'
import { useFamiliarStore } from '@/lib/familiar'
import { MemoryNote } from '../memory-note'
import type { SubjectPageProps } from './types'

/** A subject's profile and its notes, newest first, read when it changes. */
export const SubjectPage = ({ familiar, subject }: SubjectPageProps) => {
  const store = useFamiliarStore()
  const page = useQuery({
    queryKey: ['memory', familiar, 'page', subject.id, subject.changed],
    queryFn: () => store.memory.page(subject.id),
  })
  if (!page.data) {
    return null
  }
  const notes = page.data.notes.toReversed()

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground">
        {page.data.profile || 'No profile yet: it is written overnight.'}
      </p>
      {notes.length === 0 && (
        <p className="text-xs text-muted-foreground">No notes.</p>
      )}
      <ul className="flex flex-col gap-3">
        {notes.map((note) => (
          <MemoryNote
            key={note.id}
            familiar={familiar}
            note={note}
            subject={subject}
          />
        ))}
      </ul>
    </div>
  )
}
