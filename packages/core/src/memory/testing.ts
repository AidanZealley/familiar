import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  createRegistry,
  Harness,
  MemoryStorage,
  type JsonObject,
  type SessionDocToken,
  type Storage,
} from '@earendil-works/pi-durable'
import { openMemory, rememberFact } from './facts.ts'

/** Test helpers for memory; not part of Familiar. */

/** Opens a bare Harness on `storage`, runs `use`, and closes it again. */
export async function withHarness<T>(
  storage: Storage,
  use: (harness: Harness) => Promise<T>,
) {
  const harness = await Harness.open(
    storage,
    { models: createModels(), registry: createRegistry() },
    BACKGROUND_CONTEXT,
  )
  try {
    return await use(harness)
  } finally {
    await harness.close(BACKGROUND_CONTEXT)
  }
}

/**
 * Storage that already holds these facts, as nightly upkeep would have
 * saved them; the conversation model can't save facts itself. Each is saved
 * now unless given a time, so none is due for review. Closing the storage
 * does nothing, so a test can read it after dismissing Familiar.
 */
export async function storageWith(
  ...facts: [text: string, importance: number, saved?: number][]
): Promise<Storage> {
  const now = Date.now()
  const storage = new MemoryStorage()
  const kept = new Proxy(storage, {
    get: (target, key) =>
      key === 'close' ? async () => {} : Reflect.get(target, key, target),
  })
  await withHarness(kept, (harness) =>
    harness.commit(async (tx) => {
      const memory = await openMemory(tx)
      for (const [text, importance, saved = now] of facts) {
        rememberFact(
          memory,
          { text, importance, since: '2026-01-05', sources: [] },
          saved,
        )
      }
    }, BACKGROUND_CONTEXT),
  )
  return kept
}

/** A stored memory document's value, read once Familiar has been dismissed. */
export const readStored = <T extends JsonObject>(
  storage: Storage,
  doc: SessionDocToken<T>,
) =>
  withHarness(storage, async (harness) => {
    const watch = (await harness.watchDoc(doc, BACKGROUND_CONTEXT))!
    await watch.stop()
    // Memory's start() creates its documents, so this one exists.
    return watch.value!
  })
