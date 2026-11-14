import { CaretRightIcon } from '@phosphor-icons/react'
import { describe } from '../subject-page'
import type { SubjectListProps } from './types'

/** Every subject, in the prompt's order: people who take part, then the rest by last change. */
export const SubjectList = ({
  familiar,
  subjects,
  onOpen,
}: SubjectListProps) => {
  const ordered = [
    ...subjects.filter((subject) => subject.person),
    ...subjects
      .filter((subject) => !subject.person)
      .toSorted((a, b) => b.changed - a.changed),
  ]

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Everyone and everything {familiar.name} keeps notes about. Each has a
        page: its notes, and a profile written from them each night.
      </p>
      {ordered.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing yet.</p>
      ) : (
        <ul className="border-t">
          {ordered.map((subject) => (
            <li key={subject.id} className="border-b">
              <button
                type="button"
                onClick={() => onOpen(subject.id)}
                className="flex w-full items-baseline gap-2 py-2 text-left hover:bg-muted/50"
              >
                <span className="font-medium">{subject.name}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {describe(subject)}
                </span>
                <CaretRightIcon className="shrink-0 self-center text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
