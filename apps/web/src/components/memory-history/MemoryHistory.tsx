import { useFamiliar } from '@familiar-ai/client/react'
import { historyChains } from '@/lib/memory'
import { HistoryChain } from './components/history-chain'

export const MemoryHistory = () => {
  const facts = useFamiliar((state) => state.memory.facts?.facts)
  const chains = facts ? historyChains(facts) : []

  return (
    <div className="flex flex-col gap-8">
      {facts && chains.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing has changed yet.
        </p>
      )}
      {chains.map((chain) => (
        <HistoryChain key={chain.at(-1)!.id} chain={chain} />
      ))}
    </div>
  )
}
