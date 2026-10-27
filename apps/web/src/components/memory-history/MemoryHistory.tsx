import { PageHeading } from '@/components/page-heading'
import { useFamiliar } from '@/lib/familiar'
import { historyChains } from '@/lib/memory'
import { HistoryChain } from './components/history-chain'

export const MemoryHistory = () => {
  const facts = useFamiliar((state) => state.memory?.facts)
  const chains = facts ? historyChains(facts) : []

  return (
    <div className="flex flex-col gap-8">
      <PageHeading
        title="History"
        description="Things that changed, newest first. Familiar keeps old versions so it can answer “where did I live before?”"
      />
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
