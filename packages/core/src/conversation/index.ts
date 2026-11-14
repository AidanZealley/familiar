import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import {
  AgentDoc,
  configure,
  InboxDoc,
  LiveDoc,
  type AgentState,
  type ConversationWatch,
  type DocumentWatch,
  type Harness,
} from '@earendil-works/pi-durable'
import {
  findModelChoice,
  ModelError,
  modelKey,
  ThinkingLevels,
  type ModelOption,
} from './models.ts'
import { familiarDoc, type FamiliarId } from '../workspace/familiars.ts'

/**
 * A Familiar's chat: its one working context across every room, which only
 * its rooms' turns write to. People see their rooms, never the chat itself.
 */
export type ConversationApi = {
  /**
   * The chat's committed view, then every commit's changes to it: what the
   * Familiar was shown and did in all its rooms, so never for people.
   */
  watch(): Promise<ConversationWatch>
  /** Which model the chat is on, and at what level, then every change. */
  watchModel(): Promise<DocumentWatch<AgentState>>
  /** The models the chat may switch to. */
  models(): ModelOption[]
  /**
   * Change the current model's reasoning level, remembered for that model.
   * Throws a ModelError for a level it doesn't support.
   */
  setThinkingLevel(level: ModelThinkingLevel): Promise<void>
}

const context = BACKGROUND_CONTEXT

/**
 * `familiar`'s chat, which its ID names, offering `options`. Which model it
 * is on is the workspace's to set (see workspace/models.ts).
 */
export async function installConversation(
  harness: Harness,
  familiar: FamiliarId,
  options: ModelOption[],
): Promise<ConversationApi> {
  const conversation = await harness.conversation(familiar, context)
  if (!conversation) {
    throw new Error(`No chat for Familiar ${familiar}.`)
  }
  // Its live documents are created first, so a room's stream can watch them
  // before its first run.
  await conversation.commit(async (tx) => {
    await tx.doc(AgentDoc, conversation.id)
    await tx.doc(LiveDoc, conversation.id)
    await tx.doc(InboxDoc, conversation.id)
  }, context)

  return {
    watch: () => conversation.watch(context),
    // Created above, so it exists.
    watchModel: async () =>
      (await harness.watchDoc(AgentDoc, familiar, context))!,
    models: () => options,
    setThinkingLevel: async (level) => {
      await conversation.commit(async (tx) => {
        // Reads before writes: a transaction cannot read tables after writing.
        const agent = await tx.doc(AgentDoc, conversation.id)
        const levels = await familiarDoc(tx, ThinkingLevels, familiar)
        // The workspace always leaves the chat on a model choice.
        const current = findModelChoice(options, agent.model)!
        if (!current.thinkingLevels.includes(level)) {
          throw new ModelError(`${current.name} has no ${level} reasoning.`)
        }
        levels[modelKey(current.model)] = level
        await configure(tx, conversation.id, { thinkingLevel: level })
      }, context)
    },
  }
}
