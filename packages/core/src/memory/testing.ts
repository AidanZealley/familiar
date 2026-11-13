import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  createRegistry,
  Harness,
  type Storage,
  type Tx,
} from '@earendil-works/pi-durable'
import { ReopenableStorage } from '../testing.ts'
import {
  createFamiliar,
  Familiars,
  type FamiliarId,
} from '../workspace/familiars.ts'
import { keyOf, Memory, Pages, type Subject } from './store.ts'

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
 * Gives `familiar` a page as consolidation would have left it: a subject
 * with a profile. Returns the subject's ID.
 */
export async function seedPage(
  tx: Tx,
  familiar: FamiliarId,
  subject: Pick<Subject, 'name' | 'kind'> & Partial<Subject>,
  profile: string,
) {
  const memory = await tx.doc(Memory, String(familiar), null)
  const id = subject.id ?? `s${memory.next.subject++}`
  if (!memory.subjects.some((other) => other.id === id)) {
    memory.subjects.push({
      line: '',
      changed: 1,
      profiled: 1,
      ...subject,
      id,
    })
  }
  ;(await tx.doc(Pages, keyOf(familiar, id), null)).profile = profile
  return id
}

/** Storage with a Familiar whose memory has these profiles, by subject name. */
export async function storageWith(
  ...pages: [name: string, profile: string][]
): Promise<Storage> {
  const storage = new ReopenableStorage()
  await withHarness(storage, (harness) =>
    harness.commit(async (tx) => {
      const familiar = await createFamiliar(tx, { name: 'Familiar' })
      for (const [name, profile] of pages) {
        await seedPage(tx, familiar, { name, kind: 'topic' }, profile)
      }
    }, BACKGROUND_CONTEXT),
  )
  return storage
}
