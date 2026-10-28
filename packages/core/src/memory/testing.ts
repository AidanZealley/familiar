import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  createRegistry,
  Harness,
  MemoryStorage,
} from '@earendil-works/pi-durable'
import { openMemory, rememberFact } from './facts.ts'

/** Test helpers for memory; not part of Familiar. */

/**
 * Storage that already holds these facts, as nightly upkeep would have
 * saved them; the conversation model can't save facts itself.
 */
export async function storageWith(
  ...facts: [text: string, importance: number][]
) {
  const storage = new MemoryStorage()
  // Closing this Harness must leave the storage open for Familiar.
  const kept = new Proxy(storage, {
    get: (target, key) =>
      key === 'close' ? async () => {} : Reflect.get(target, key, target),
  })
  const harness = await Harness.open(
    kept,
    { models: createModels(), registry: createRegistry() },
    BACKGROUND_CONTEXT,
  )
  await harness.commit(async (tx) => {
    const memory = await openMemory(tx)
    for (const [text, importance] of facts) {
      rememberFact(
        memory,
        { text, importance, since: '2026-01-05', sources: [] },
        1,
      )
    }
  }, BACKGROUND_CONTEXT)
  await harness.close(BACKGROUND_CONTEXT)
  return storage
}
