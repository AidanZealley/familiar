import { useQuery } from '@tanstack/react-query'
import { useFamiliarStore } from '@/lib/familiar'
import type { PromptSectionProps } from './types'

/** The memory section of the prompt, word for word, read again when a page changes. */
export const PromptSection = ({ familiar, memory }: PromptSectionProps) => {
  const store = useFamiliarStore()
  const revision = memory.subjects.reduce(
    (latest, subject) => Math.max(latest, subject.changed, subject.profiled),
    0,
  )
  const section = useQuery({
    queryKey: ['memory', familiar.id, 'section', revision],
    queryFn: () => store.memory.section(),
  })

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Exactly what {familiar.name} sees before every reply: the profile of
        each person it works with, and a roster of every other subject.
      </p>
      <pre className="bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
        {section.data ?? '…'}
      </pre>
    </div>
  )
}
