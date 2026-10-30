import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Harness } from '@earendil-works/pi-durable'
import { Facts, markRecalled, MemoryUsage } from './facts.ts'
import { datesIn, Episodes } from './episodes.ts'
import { createMemoryExtension } from './extension.ts'
import { transcriptExchanges } from './exchanges.ts'
import { createSearchTimes } from './health.ts'
import { recallNote, UNFILED } from './recall.ts'
import { Upkeep } from './upkeep/schedule.ts'
import { localDay } from '../time/index.ts'
import { createUpkeep, type UpkeepOptions } from './upkeep/index.ts'
import { memoryApi } from './api.ts'

export type { MemoryApi } from './api.ts'
export type { MemoryHealth } from './health.ts'
export type { Fact, FactsState } from './facts.ts'
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
  // Both in memory for as long as Familiar runs: the index is rebuilt from
  // the transcript, and search times are only for health.
  const exchanges = transcriptExchanges()
  const times = createSearchTimes()
  const extension = createMemoryExtension({
    exchanges,
    times,
    recall: (query, unfiled) =>
      harness.commit(async (tx) => {
        const facts = await tx.doc(Facts)
        const episodes = await tx.doc(Episodes)
        // What compaction took out of the view after the last entry upkeep
        // reviewed: nothing else would show it to the model until tonight.
        const index = unfiled ? await exchanges.catchUp(tx) : undefined
        const { through } = await tx.doc(Upkeep)
        const before = exchanges.viewStart
        const now = options.now()
        return times.time(() =>
          recallNote(
            facts,
            episodes,
            index && before !== undefined
              ? index.search(query, now, {
                  limit: UNFILED.limit,
                  ranges: datesIn(query, localDay(now)),
                  within: { after: through, before },
                })
              : [],
            query,
            now,
          ),
        )
      }, BACKGROUND_CONTEXT),
    recalled: async (ids) => {
      await harness.commit(
        async (tx) =>
          markRecalled(await tx.doc(MemoryUsage), ids, options.now()),
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
        await tx.doc(Facts)
        await tx.doc(MemoryUsage)
        await tx.doc(Episodes)
      }, BACKGROUND_CONTEXT)
      await upkeep.start(harness, BACKGROUND_CONTEXT)

      return memoryApi(harness, options.now, exchanges, times)
    },
  }
}
