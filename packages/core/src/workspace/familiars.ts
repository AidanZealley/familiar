import type { Context } from '@earendil-works/chord'
import {
  defineDoc,
  type ConversationId,
  type DocumentObserver,
  type DocumentReader,
  type JsonObject,
  type ModelRef,
  type SessionDocFamilyToken,
  type Tx,
} from '@earendil-works/pi-durable'

/**
 * Which Familiars a workspace has, and which conversations each one owns.
 * Everything that needs to know whose a conversation is asks `familiarOf`,
 * and everything a Familiar keeps for itself is a document family keyed by
 * its ID, through `familiarDoc`.
 */

/** A Familiar's ID: its chat conversation's, where it does its work. */
export type FamiliarId = ConversationId

/** Who a Familiar is. */
export type FamiliarIdentity = {
  /** What it's called: in its default persona, its notifications and memory's prompts. */
  name: string
  /**
   * Who it is in conversation, in place of `defaultPersona(name)`, used
   * exactly as given, so it includes the name if the model should know it.
   */
  persona?: string
  /**
   * How the host's UI draws it, such as an index into its set of
   * portraits; without one, the UI derives one from its ID. Core keeps it
   * for the host and never reads it. At most `AVATAR_LENGTH` characters.
   */
  avatar?: string
  /**
   * What its memory's filing and consolidation run on, instead of the workspace's `memoryModel`:
   * one of `modelChoices`, at that choice's level. Applies from the next
   * pass. If a later restart drops it from `modelChoices`, memory falls back
   * to the workspace's.
   */
  memoryModel?: ModelRef
}

/** The longest avatar a Familiar may keep: a choice, not an image. */
export const AVATAR_LENGTH = 64

export type FamiliarRecord = FamiliarIdentity & {
  /**
   * Where memory's model calls run, one at a time: filing what people said,
   * and tidying a page. Each call sets it up for its job and starts it from
   * nothing. Named for the nightly upkeep it replaced.
   */
  upkeep: ConversationId
}

export type FamiliarsState = {
  /** By FamiliarId. Object keys are strings, so a key is `String(id)`. */
  familiars: Record<string, FamiliarRecord>
}

export const Familiars = defineDoc<FamiliarsState>({
  kind: 'familiar.familiars',
  version: 1,
  scope: 'session',
  initial: () => ({ familiars: {} }),
  checkpointWhen: () => true, // small: always store it whole
})

/**
 * A Familiar's own document of a family, keyed by its ID. Removing it
 * retires each family in remove.ts's `FAMILIAR_DOCS`, so a new one joins it.
 */
export const familiarDoc = <T extends JsonObject>(
  tx: Tx,
  family: SessionDocFamilyToken<T, null>,
  familiar: FamiliarId,
) => tx.doc(family, String(familiar), null)

/** Watches a Familiar's own document of a family, once it exists. */
export const watchFamiliarDoc = <T extends JsonObject>(
  observer: DocumentObserver,
  family: SessionDocFamilyToken<T, null>,
  familiar: FamiliarId,
  context: Context,
) => observer.watchDoc(family, String(familiar), context)

/** Reads a Familiar's own document of a family, undefined until it exists. */
export const readFamiliarDoc = <T extends JsonObject>(
  read: DocumentReader,
  family: SessionDocFamilyToken<T, null>,
  familiar: FamiliarId,
  context: Context,
) => read.snapshot(family, String(familiar), context)

/** The Familiar that owns `conversation`, from the registry's state. */
export function familiarIn(
  state: Readonly<FamiliarsState>,
  conversation: ConversationId,
): FamiliarId | undefined {
  if (state.familiars[conversation]) {
    return conversation
  }
  const owner = Object.entries(state.familiars).find(
    ([, record]) => record.upkeep === conversation,
  )
  return owner && (Number(owner[0]) as FamiliarId)
}

/**
 * The Familiar that owns `conversation`, for code that runs in one: a tool,
 * a hook or a prompt section. Undefined for a conversation no Familiar owns.
 */
export const familiarOf = async (
  read: DocumentReader,
  conversation: ConversationId,
  context: Context,
) => {
  const state = await read.snapshot(Familiars, context)
  return state && familiarIn(state, conversation)
}

/**
 * The Familiar that owns `conversation`, for a tool's commit. Throws for a
 * conversation no Familiar owns, where a Familiar's tools don't belong.
 */
export async function familiarFor(tx: Tx, conversation: ConversationId) {
  const familiar = familiarIn(await tx.doc(Familiars), conversation)
  if (familiar === undefined) {
    throw new Error(
      'Only a Familiar has this tool; this conversation has none.',
    )
  }
  return familiar
}

/** A Familiar's record; throws for one that doesn't exist, which is a bug. */
export async function familiarRecord(tx: Tx, familiar: FamiliarId) {
  const record = (await tx.doc(Familiars)).familiars[familiar]
  if (!record) {
    throw new Error(`No Familiar ${familiar}.`)
  }
  return record
}

/**
 * A Familiar's identity, if its name, any persona and any avatar aren't
 * blank, and its avatar isn't longer than `AVATAR_LENGTH`.
 */
export function checkIdentity<T extends Partial<FamiliarIdentity>>(
  identity: T,
) {
  for (const [field, value] of Object.entries(identity)) {
    if (typeof value === 'string' && !value.trim()) {
      throw new TypeError(`A Familiar's ${field} must not be blank.`)
    }
  }
  if (
    typeof identity.avatar === 'string' &&
    identity.avatar.length > AVATAR_LENGTH
  ) {
    throw new TypeError(
      `A Familiar's avatar must be at most ${AVATAR_LENGTH} characters.`,
    )
  }
  return identity
}

/** Sets one of a record's optional fields, or removes it for `null`. */
export function change<K extends 'persona' | 'avatar' | 'memoryModel'>(
  record: FamiliarRecord,
  field: K,
  value: FamiliarRecord[K] | null | undefined,
) {
  if (value === null) {
    delete record[field]
  } else if (value !== undefined) {
    record[field] = value
  }
}

/**
 * Creates a Familiar: its chat, whose ID is its own, and memory's
 * conversation. Opening the Familiar sets its chat up; each of memory's calls, memory's.
 */
export async function createFamiliar(tx: Tx, identity: FamiliarIdentity) {
  const ownerless = { ownership: { kind: 'ownerless' } } as const
  const chat = await tx.createConversation(ownerless)
  const upkeep = await tx.createConversation(ownerless)
  ;(await tx.doc(Familiars)).familiars[chat.id] = {
    ...checkIdentity(identity),
    upkeep: upkeep.id,
  }
  return chat.id as FamiliarId
}
