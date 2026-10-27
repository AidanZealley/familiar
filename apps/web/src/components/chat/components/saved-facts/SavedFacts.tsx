import { useFamiliar } from '@/lib/familiar'
import { SavedFact } from '../saved-fact'
import type { SavedFactsProps } from './types'

/** The facts a reply saved, as they stand now; forgotten ones are gone. */
export const SavedFacts = ({ ids }: SavedFactsProps) => {
  const facts = useFamiliar((state) => state.memory?.facts)
  const saved = ids.flatMap((id) => facts?.find((fact) => fact.id === id) ?? [])
  if (saved.length === 0) return null

  return (
    <div>
      <p className="mb-1 font-heading text-[0.65rem] text-muted-foreground uppercase">
        saved
      </p>
      <div className="flex flex-col items-start gap-1">
        {saved.map((fact) => (
          <SavedFact key={fact.id} fact={fact} />
        ))}
      </div>
    </div>
  )
}
