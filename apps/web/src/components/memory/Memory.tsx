import { useFamiliar } from '@/lib/familiar'
import { FactItem } from './components/fact-item'

export const Memory = () => {
  const memory = useFamiliar((state) => state.memory)
  // Newest first: what was learnt recently is what most needs checking.
  // Past facts are history, not what Familiar currently believes.
  const facts =
    memory?.facts.filter((fact) => fact.until === undefined).toReversed() ?? []

  return (
    <main className="flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <p className="py-4 text-sm text-muted-foreground">
        What Familiar remembers about you. It keeps this itself as you chat;
        correct or remove anything here and it sees the change on its next
        reply.
      </p>
      {memory !== undefined && facts.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing yet. Tell it something worth remembering.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {facts.map((fact) => (
          <FactItem key={fact.id} fact={fact} />
        ))}
      </ul>
    </main>
  )
}
