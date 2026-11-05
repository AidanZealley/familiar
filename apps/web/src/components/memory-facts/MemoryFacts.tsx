import { BrainIcon, LayersIcon, PinIcon } from 'lucide-react'
import { useFamiliar } from '@/lib/familiar'
import { coreFacts, reserveFacts } from '@/lib/memory'
import { FactList } from './components/fact-list'
import { MemoryOverview } from './components/memory-overview'

export const MemoryFacts = () => {
  const facts = useFamiliar((state) => state.memory?.facts)
  if (!facts) {
    return null
  }
  const core = coreFacts(facts)
  const reserve = reserveFacts(facts)

  if (core.length + reserve.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nothing yet. What you tell Familiar is filed here each night.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-10">
      <MemoryOverview facts={facts} />
      <FactList
        title="Pinned"
        icon={PinIcon}
        description="Always in core, whatever their importance."
        facts={core.filter((fact) => fact.pinned)}
      />
      <FactList
        title="Core"
        icon={BrainIcon}
        description="Read before every reply, most important first."
        facts={core.filter((fact) => !fact.pinned)}
      />
      <FactList
        title="Reserve"
        icon={LayersIcon}
        description="Kept, and brought into a reply when it seems relevant."
        facts={reserve}
      />
    </div>
  )
}
