import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Harness } from '@earendil-works/pi-durable'
import { markRecalled } from './facts.ts'
import { Memory, createMemoryExtension } from './memory.ts'
import { createUpkeep, type UpkeepOptions } from './upkeep.ts'
import { memoryApi } from './api.ts'

export * from './memory.ts'
export * from './upkeep.ts'
export * from './facts.ts'
export * from './recall.ts'
export type { MemoryApi } from './api.ts'

export type MemoryOptions = Omit<UpkeepOptions, 'extension'> & {
  /** Familiar's clock. */
  now: () => number
}

export function createMemory(options: MemoryOptions) {
  // Set by start(); the model can't run, so nothing is recalled, before then.
  let harness: Harness | undefined
  const extension = createMemoryExtension({
    now: options.now,
    recalled: async (ids) => {
      await harness!.commit(
        async (tx) => markRecalled(await tx.doc(Memory), ids, options.now()),
        BACKGROUND_CONTEXT,
      )
    },
  })
  const upkeep = createUpkeep({ ...options, extension })
  return {
    extensions: [extension, upkeep.extension],
    async start(opened: Harness) {
      harness = opened
      // Watches only attach to documents that exist.
      await harness.commit((tx) => tx.doc(Memory), BACKGROUND_CONTEXT)
      await upkeep.start(harness, BACKGROUND_CONTEXT)
      return memoryApi(harness)
    },
  }
}
