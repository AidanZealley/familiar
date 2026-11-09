import type { Context } from '@earendil-works/chord'
import {
  defineDoc,
  type ConversationId,
  type DocumentObserver,
  type DocumentReader,
  type JsonObject,
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

export type FamiliarRecord = {
  /** What it's called: in notifications, and in memory upkeep's prompts. */
  name: string
  /** Where memory upkeep files the chat each night, with the writing tools. */
  upkeep: ConversationId
  /** Where upkeep writes week and month rollups, with no tools at all. */
  rollups: ConversationId
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

/** A Familiar's own document of a family, keyed by its ID. */
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
    ([, record]) =>
      record.upkeep === conversation || record.rollups === conversation,
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
 * Creates a Familiar: its chat, whose ID is its own, and memory upkeep's two
 * conversations. Opening it sets each up.
 */
export async function createFamiliar(tx: Tx, name: string) {
  const ownerless = { ownership: { kind: 'ownerless' } } as const
  const chat = await tx.createConversation(ownerless)
  const upkeep = await tx.createConversation(ownerless)
  const rollups = await tx.createConversation(ownerless)
  ;(await tx.doc(Familiars)).familiars[chat.id] = {
    name,
    upkeep: upkeep.id,
    rollups: rollups.id,
  }
  return chat.id as FamiliarId
}
