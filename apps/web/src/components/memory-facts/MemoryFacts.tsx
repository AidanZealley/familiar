import { BrainIcon, StackIcon } from '@phosphor-icons/react'
import { useFamiliar } from '@/lib/familiar'
import { coreFacts, coreSize, reserveFacts } from '@/lib/memory'
import { BudgetMeter } from './components/budget-meter'
import { FactSection } from './components/fact-section'

/**
 * What a Familiar knows now: how much of core's budget it uses, then core's
 * facts, pinned first then most important, then reserve's.
 */
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
    <div className="flex flex-col gap-8">
      <BudgetMeter size={coreSize(core)} />
      <FactSection
        icon={BrainIcon}
        title="Core"
        description="Read before every reply, pinned and most important first."
        facts={core}
      />
      <FactSection
        icon={StackIcon}
        title="Reserve"
        description="Kept, and brought into a reply when it seems relevant."
        facts={reserve}
      />
    </div>
  )
}
