import type { FamiliarSummary } from '@familiar-ai/client'
import type { CapabilitySource } from '@/components/capability-switch'
import { capabilitiesKey, useFamiliarStore } from '@/lib/familiar'

/** The Familiar's own capabilities, for its switches. */
export const useCapabilitySource = (
  familiar: FamiliarSummary,
): CapabilitySource => {
  const store = useFamiliarStore()
  return {
    key: capabilitiesKey(familiar.id),
    get: () => store.capabilities.get(),
    set: store.capabilities.set,
  }
}
