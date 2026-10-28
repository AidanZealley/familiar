import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Harness } from '@earendil-works/pi-durable'
import { markRecalled, Memory } from './facts.ts'
import { Episodes } from './episodes.ts'
import { createMemoryExtension } from './extension.ts'
import { createUpkeep, type UpkeepOptions } from './upkeep/index.ts'
import { memoryApi } from './api.ts'

export type { MemoryApi } from './api.ts'
export type { Fact, MemoryState } from './facts.ts'
export type { Episode, EpisodesState } from './episodes.ts'

export type MemoryOptions = Omit<UpkeepOptions, 'extension'> & {
  /** Familiar's clock. */
  now: () => number
}

/**
 * Memory's extensions, to install, and `start`, to call once they are. Nothing
 * runs before the Harness resumes, so it can open before they're installed.
 */
export function createMemory(harness: Harness, options: MemoryOptions) {
  const extension = createMemoryExtension({
    now: options.now,
    recalled: async (ids) => {
      await harness.commit(
        async (tx) => markRecalled(await tx.doc(Memory), ids, options.now()),
        BACKGROUND_CONTEXT,
      )
    },
  })

  const upkeep = createUpkeep({ ...options, extension })

  return {
    extensions: [extension, upkeep.extension],
    start: async () => {
      // Watches only attach to documents that exist.
      await harness.commit(async (tx) => {
        await tx.doc(Memory)
        await tx.doc(Episodes)
      }, BACKGROUND_CONTEXT)
      await upkeep.start(harness, BACKGROUND_CONTEXT)

      return memoryApi(harness, options.now)
    },
  }
}
