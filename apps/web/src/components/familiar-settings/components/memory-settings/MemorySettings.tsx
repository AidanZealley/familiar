import { MemoryPages } from '@/components/memory-pages'
import { MemoryModel } from './components/memory-model'
import type { MemorySettingsProps } from './types'

/** What memory's filing runs on, and what memory holds. */
export const MemorySettings = ({ familiar }: MemorySettingsProps) => (
  <div className="flex flex-col gap-6 text-sm">
    <MemoryModel familiar={familiar} />
    <MemoryPages familiar={familiar.id} />
  </div>
)
