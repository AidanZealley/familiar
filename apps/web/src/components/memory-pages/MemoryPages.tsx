import { useQuery } from '@tanstack/react-query'
import { CaretRightIcon } from '@phosphor-icons/react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useFamiliar, useFamiliarStore } from '@/lib/familiar'
import { SubjectPage } from './components/subject-page'
import type { MemoryPagesProps } from './types'

/**
 * The plainest view of a Familiar's memory: what the model always sees,
 * then each subject's page. Read-only but for forgetting a note. Its real
 * design comes later.
 */
export const MemoryPages = ({ familiar }: MemoryPagesProps) => {
  const store = useFamiliarStore()
  const memory = useFamiliar((state) => state.memory)
  // Changes whenever a page does, so the section is read again.
  const revision = memory?.subjects.reduce(
    (latest, subject) => Math.max(latest, subject.changed),
    memory.forgotten.length,
  )
  const section = useQuery({
    queryKey: ['memory', familiar, 'section', revision],
    queryFn: () => store.memory.section(),
    enabled: revision !== undefined,
  })
  if (!memory) {
    return null
  }
  const subjects = memory.subjects.toSorted(
    (a, b) =>
      Number(b.kind === 'self') - Number(a.kind === 'self') ||
      b.changed - a.changed,
  )

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">What it always sees</h3>
        <pre className="max-h-80 overflow-auto bg-muted p-3 text-xs whitespace-pre-wrap">
          {section.data ?? '…'}
        </pre>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Pages</h3>
        {subjects.map((subject) => (
          <Collapsible key={subject.id}>
            <CollapsibleTrigger className="group flex w-full items-center gap-2 py-1 text-left">
              <CaretRightIcon className="shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
              <span className="font-medium">
                {subject.kind === 'self' ? 'Itself' : subject.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {subject.line}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 pb-4 pl-6">
              <SubjectPage familiar={familiar} subject={subject} />
            </CollapsibleContent>
          </Collapsible>
        ))}
      </section>
    </div>
  )
}
