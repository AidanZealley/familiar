import {
  defineDoc,
  ROOT_CONVERSATION_ID,
  type ConversationId,
  type EntryId,
  type JsonObject,
  type SessionDocFamilyToken,
  type TaskId,
  type Tx,
} from '@earendil-works/pi-durable'
import { ThinkingLevels } from '../conversation/models.ts'
import { Episodes } from '../memory/episodes.ts'
import { Facts, MemoryUsage } from '../memory/facts.ts'
import { Upkeep } from '../memory/upkeep/schedule.ts'
import { Schedules } from '../schedules/schedules.ts'
import { familiarDoc, Familiars, type FamiliarId } from './familiars.ts'

/**
 * Before workspaces, a store held one Familiar: its chat was the root
 * conversation, and what it kept for itself was one session document each.
 * Adopting such a store makes it Familiar `ROOT_CONVERSATION_ID` and moves
 * each document into that Familiar's member of the family of the same kind.
 */

/** A draft's value, detached from it. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/**
 * Moves the pre-workspace document of `family`'s kind, stored at `version`,
 * into `familiar`'s member, as it is, and retires it.
 */
async function move<T extends JsonObject>(
  tx: Tx,
  family: SessionDocFamilyToken<T, null>,
  version: number,
  familiar: FamiliarId,
) {
  const old = defineDoc<T>({
    kind: family.definition.kind,
    version,
    scope: 'session',
    initial: () => family.definition.initial(null),
    checkpointWhen: () => true,
  })
  const value = copy(await tx.doc(old))
  Object.assign(await familiarDoc(tx, family, familiar), value)
  await tx.retireDoc(old)
}

/** Upkeep's conversations move to the Familiar's registry record. */
const UpkeepBefore = defineDoc<{
  conversation: ConversationId | null
  rollups: ConversationId | null
  task: TaskId | null
  through: EntryId | null
}>({
  kind: Upkeep.definition.kind,
  version: 2,
  scope: 'session',
  initial: () => ({
    conversation: null,
    rollups: null,
    task: null,
    through: null,
  }),
  checkpointWhen: () => true,
})

/**
 * Adopts a pre-workspace store, in the commit `tx`, naming its Familiar
 * `name`. Does nothing to a store with Familiars already, or with no root
 * conversation, which only a pre-workspace Familiar made. It never reads the
 * old documents after retiring them: reading one again would create it anew,
 * empty. Returns the adopted Familiar, if any.
 */
export async function adoptPreWorkspaceFamiliar(
  tx: Tx,
  name: string,
): Promise<FamiliarId | undefined> {
  // Reads before writes: a transaction cannot read tables after writing.
  const root = await tx.conversation(ROOT_CONVERSATION_ID)
  const registry = await tx.doc(Familiars)
  if (!root || Object.keys(registry.familiars).length) {
    return undefined
  }
  const familiar = ROOT_CONVERSATION_ID as FamiliarId

  await move(tx, Facts, 1, familiar)
  await move(tx, MemoryUsage, 1, familiar)
  await move(tx, Episodes, 1, familiar)
  await move(tx, Schedules, 1, familiar)
  await move(tx, ThinkingLevels, 1, familiar)

  const upkeep = copy(await tx.doc(UpkeepBefore))
  await tx.retireDoc(UpkeepBefore)
  Object.assign(await familiarDoc(tx, Upkeep, familiar), {
    task: upkeep.task,
    through: upkeep.through,
  })
  // A store opened at least once has both; created here if it never was.
  const ownerless = { ownership: { kind: 'ownerless' } } as const
  registry.familiars[familiar] = {
    name,
    upkeep: upkeep.conversation ?? (await tx.createConversation(ownerless)).id,
    rollups: upkeep.rollups ?? (await tx.createConversation(ownerless)).id,
  }
  return familiar
}
