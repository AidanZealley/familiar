import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Harness } from '@earendil-works/pi-durable'
import { Memory, MemoryExtension } from './memory.ts'
import { createUpkeep, type UpkeepOptions } from './upkeep.ts'
import { memoryApi } from './api.ts'

export * from './memory.ts'
export * from './upkeep.ts'
export * from './edits.ts'
export type { MemoryApi } from './api.ts'

export function createMemory(options: UpkeepOptions) {
  const upkeep = createUpkeep(options)
  return {
    extensions: [MemoryExtension, upkeep.extension],
    async start(harness: Harness) {
      // Watches only attach to documents that exist.
      await harness.commit((tx) => tx.doc(Memory), BACKGROUND_CONTEXT)
      await upkeep.start(harness, BACKGROUND_CONTEXT)
      return memoryApi(harness)
    },
  }
}
