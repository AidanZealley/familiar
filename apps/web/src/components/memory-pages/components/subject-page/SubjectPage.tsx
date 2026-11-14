import type { Subject } from '@familiar-ai/client'
import { ArrowLeftIcon } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useFamiliarStore } from '@/lib/familiar'
import { MemoryNote } from '../memory-note'
import type { SubjectPageProps } from './types'

/** A subject's kind and roster line: `person · Maya's partner`. */
export const describe = (subject: Subject) =>
  [subject.person ? 'person in the workspace' : subject.kind, subject.line]
    .filter(Boolean)
    .join(' · ')

/** A subject's page: its profile and notes, newest first, read when it changes. */
export const SubjectPage = ({
  familiar,
  subject,
  onBack,
}: SubjectPageProps) => {
  const store = useFamiliarStore()
  const page = useQuery({
    queryKey: [
      'memory',
      familiar.id,
      'page',
      subject.id,
      subject.changed,
      subject.profiled,
    ],
    queryFn: () => store.memory.page(subject.id),
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2.5 self-start"
          onClick={onBack}
        >
          <ArrowLeftIcon /> Subjects
        </Button>
        <div className="flex flex-col gap-1">
          <h3 className="font-heading text-base font-medium">{subject.name}</h3>
          <p className="text-xs text-muted-foreground">{describe(subject)}</p>
        </div>
      </div>
      {page.data && (
        <>
          <section className="flex flex-col gap-1">
            <h4 className="text-xs font-medium text-muted-foreground">
              Profile
            </h4>
            {page.data.profile ? (
              <p>{page.data.profile}</p>
            ) : (
              <p className="text-muted-foreground italic">
                {page.data.notes.length
                  ? 'Written tonight from the notes below.'
                  : 'None: there are no notes.'}
              </p>
            )}
          </section>
          <section className="flex flex-col gap-2">
            <h4 className="text-xs font-medium text-muted-foreground">Notes</h4>
            {page.data.notes.length === 0 ? (
              <p className="text-xs text-muted-foreground">None.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {page.data.notes.toReversed().map((note) => (
                  <MemoryNote
                    key={note.id}
                    familiar={familiar}
                    note={note}
                    subject={subject}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
