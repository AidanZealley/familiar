import { MemoryPages } from '@/components/memory-pages'
import type { MemorySettingsProps } from './types'

/** What memory holds. */
export const MemorySettings = ({ familiar }: MemorySettingsProps) => (
  <div className="flex flex-col gap-6 text-sm">
    <MemoryPages familiar={familiar} />
  </div>
)
