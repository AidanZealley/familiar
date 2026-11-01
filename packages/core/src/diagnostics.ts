/**
 * For tools around Familiar rather than hosts: offline diagnostics of its
 * stored conversation, and seeding sample memory (the demo, the eval). Not
 * part of the API a host gives people.
 */
export { nextUpkeep, type UpkeepState } from './memory/upkeep/schedule.ts'
export { saidBy } from './conversation/message.ts'
export { Facts, type Fact } from './memory/facts.ts'
export { Episodes, type Episode } from './memory/episodes.ts'
export { createExchangeIndex, type Exchange } from './memory/exchanges.ts'
export { datesIn } from './memory/episodes.ts'
export { localDay } from './time/index.ts'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  Harness,
  createRegistry,
  type Storage,
} from '@earendil-works/pi-durable'
import { Facts, type Fact } from './memory/facts.ts'
import { Episodes, type Episode } from './memory/episodes.ts'

/**
 * Offline only: no Familiar may be running on storage. Closes storage when done;
 * in-memory demos must keep their state reopenable.
 */
export async function seedSampleMemory(
  storage: Storage,
  facts: Fact[],
  episodes: Omit<Episode, 'id'>[],
) {
  const harness = await Harness.open(
    storage,
    { models: createModels(), registry: createRegistry() },
    BACKGROUND_CONTEXT,
  )
  try {
    await harness.commit(async (tx) => {
      const memory = await tx.doc(Facts)
      memory.facts = facts
      memory.next = facts.length + 1
      const state = await tx.doc(Episodes)
      for (const episode of episodes) {
        state.episodes.push({ id: `e${state.next++}`, ...episode })
      }
    }, BACKGROUND_CONTEXT)
  } finally {
    await harness.close(BACKGROUND_CONTEXT)
  }
}
