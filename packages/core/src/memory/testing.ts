import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  createRegistry,
  Harness,
  type JsonObject,
  type SessionDocFamilyToken,
  type Storage,
  type Tx,
} from '@earendil-works/pi-durable'
import { ReopenableStorage } from '../testing.ts'
import {
  createFamiliar,
  familiarDoc,
  Familiars,
  type FamiliarId,
} from '../workspace/familiars.ts'
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

/** The one Familiar a test's store holds. */
export async function onlyFamiliar(tx: Tx) {
  const [id] = Object.keys((await tx.doc(Familiars)).familiars)
  if (id === undefined) {
    throw new Error('This store has no Familiar.')
  }
  return Number(id) as FamiliarId
}

/**
 * Storage with a Familiar that already holds these facts, as nightly upkeep
 * would have saved them; the conversation model can't save facts itself.
 * Each is saved now unless given a time, so none is due for review. Closing
 * the storage does nothing, so a test can read it after dismissing Familiar.
 */
export async function storageWith(
  ...facts: [text: string, importance: number, saved?: number][]
): Promise<Storage> {
  const now = Date.now()
  const storage = new ReopenableStorage()
  await withHarness(storage, (harness) =>
    harness.commit(async (tx) => {
      const memory = await openMemory(tx, await createFamiliar(tx, 'Familiar'))
      for (const [text, importance, saved = now] of facts) {
        rememberFact(
          memory,
          { text, importance, since: '2026-01-05', sources: [] },
          saved,
        )
      }
    }, BACKGROUND_CONTEXT),
  )
  return storage
}

/** The store's one Familiar's document, read once it has been dismissed. */
export const readStored = <T extends JsonObject>(
  storage: Storage,
  family: SessionDocFamilyToken<T, null>,
) =>
  withHarness(storage, (harness) =>
    harness.commit(
      async (tx) =>
        JSON.parse(
          JSON.stringify(await familiarDoc(tx, family, await onlyFamiliar(tx))),
        ) as T,
      BACKGROUND_CONTEXT,
    ),
  )
