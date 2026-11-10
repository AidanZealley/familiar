import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Harness } from '@earendil-works/pi-durable'
import { Facts, markRecalled, MemoryUsage } from './facts.ts'
import { datesIn, Episodes } from './episodes.ts'
import { createMemoryExtension } from './extension.ts'
import { exchangesByFamiliar } from './exchanges.ts'
import { recallNote, UNFILED } from './recall.ts'
import { Upkeep } from './upkeep/schedule.ts'
import { localDay } from '../time.ts'
import { answeredInput } from '../conversation/message.ts'
import { createUpkeep, type UpkeepOptions } from './upkeep/index.ts'
import { memoryApi } from './api.ts'
import { familiarDoc, type FamiliarId } from '../workspace/familiars.ts'

export type { MemoryApi } from './api.ts'
export type { Fact, FactsState } from './facts.ts'
export type { Episode, EpisodesState } from './episodes.ts'

export type MemoryOptions = Omit<UpkeepOptions, 'extension'> & {
  /** Familiar's clock. */
  now: () => number
}

/**
 * Memory's extensions, to install, and `open`, to call for each Familiar once
 * they are. Nothing runs before the Harness resumes, so it can open before
 * they're installed.
 */
export function createMemory(harness: Harness, options: MemoryOptions) {
  // In memory for as long as the workspace runs: rebuilt from the transcripts.
  const exchangesOf = exchangesByFamiliar(options.timeZone)
  const extension = createMemoryExtension({
    exchangesOf,
    timeZone: options.timeZone,
    recall: (familiar, model, request, unfiled) =>
      harness.commit(async (tx) => {
        // The input's own words, as sent: a person's message, a reminder's
        // prompt or a handoff's note, so the model copy's header and the
        // room's context, which the next turn may show again, match nothing.
        const query = (await answeredInput(tx, request))?.text ?? model
        const facts = await familiarDoc(tx, Facts, familiar)
        const episodes = await familiarDoc(tx, Episodes, familiar)
        // What compaction took out of the view after the last entry upkeep
        // reviewed: nothing else would show it to the model until tonight.
        const exchanges = exchangesOf(familiar)
        const index = unfiled ? await exchanges.catchUp(tx) : undefined
        const { through } = await familiarDoc(tx, Upkeep, familiar)
        const before = exchanges.viewStart
        const now = options.now()
        return recallNote(
          facts,
          episodes,
          index && before !== undefined
            ? index.search(query, now, {
                limit: UNFILED.limit,
                ranges: datesIn(query, localDay(now, options.timeZone)),
                within: { after: through, before },
              })
            : [],
          query,
          now,
          options.timeZone,
        )
      }, BACKGROUND_CONTEXT),
    recalled: async (familiar, ids) => {
      await harness.commit(
        async (tx) =>
          markRecalled(
            await familiarDoc(tx, MemoryUsage, familiar),
            ids,
            options.now(),
          ),
        BACKGROUND_CONTEXT,
      )
    },
  })

  const upkeep = createUpkeep({ ...options, extension })

  return {
    extensions: [extension, upkeep.extension],
    /** Starts `familiar`'s upkeep and returns its memory. */
    open: async (familiar: FamiliarId) => {
      // Watches only attach to documents that exist.
      await harness.commit(async (tx) => {
        await familiarDoc(tx, Facts, familiar)
        await familiarDoc(tx, MemoryUsage, familiar)
        await familiarDoc(tx, Episodes, familiar)
      }, BACKGROUND_CONTEXT)
      await upkeep.start(harness, familiar, BACKGROUND_CONTEXT)

      return memoryApi(harness, familiar, options.now, options.timeZone)
    },
  }
}
