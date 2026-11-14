import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Models, ModelThinkingLevel } from '@earendil-works/pi-ai'
import {
  AgentDoc,
  configure,
  InboxDoc,
  LiveDoc,
  type AgentState,
  type ConversationWatch,
  type DocumentWatch,
  type Harness,
  type ModelRef,
} from '@earendil-works/pi-durable'
import {
  findModelChoice,
  ModelError,
  modelKey,
  modelOptions,
  ThinkingLevels,
  type ModelChoice,
  type ModelOption,
  type ThinkingLevelsState,
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
   * Switch to one of `models()`, on the level last picked for it, else its
   * default. Throws a ModelError for any other model.
   */
  setModel(model: ModelRef): Promise<void>
  /**
   * Change the current model's reasoning level, remembered for that model.
   * Throws a ModelError for a level it doesn't support.
   */
  setThinkingLevel(level: ModelThinkingLevel): Promise<void>
}

export type ConversationOptions = {
  models: Models
  /** What a new conversation starts on, and what it falls back to. */
  chatModel: ModelRef
  modelChoices: readonly ModelChoice[]
}

const context = BACKGROUND_CONTEXT

/** `choice`'s level: the one last picked for it, else its default. */
const levelOf = (levels: ThinkingLevelsState, choice: ModelChoice) =>
  levels[modelKey(choice.model)] ?? choice.thinkingLevel

/** `familiar`'s chat, which its ID names. */
export async function installConversation(
  harness: Harness,
  familiar: FamiliarId,
  { models, chatModel, modelChoices }: ConversationOptions,
): Promise<ConversationApi> {
  // Every choice resolved once, so a catalog missing one fails at startup.
  const options = modelOptions(models, modelChoices)
  // openWorkspace checked that `chatModel` is one of them.
  const fallback = findModelChoice(options, chatModel)!

  const conversation = await harness.conversation(familiar, context)
  if (!conversation) {
    throw new Error(`No chat for Familiar ${familiar}.`)
  }
  // The conversation owns its model and level. A new one, or one whose model
  // is no longer offered, starts on the fallback. Its live documents are
  // created too, so a room's stream can watch them before its first run.
  await conversation.commit(async (tx) => {
    const agent = await tx.doc(AgentDoc, conversation.id)
    await tx.doc(LiveDoc, conversation.id)
    await tx.doc(InboxDoc, conversation.id)
    const levels = await familiarDoc(tx, ThinkingLevels, familiar)
    const kept = findModelChoice(options, agent.model)
    const chosen = kept ?? fallback
    await configure(tx, conversation.id, {
      model: chosen.model,
      thinkingLevel: (kept && agent.thinkingLevel) ?? levelOf(levels, chosen),
    })
  }, context)

  return {
    watch: () => conversation.watch(context),
    // Configured above, so it exists.
    watchModel: async () =>
      (await harness.watchDoc(AgentDoc, familiar, context))!,
    models: () => options,
    setModel: async (model) => {
      const chosen = findModelChoice(options, model)
      if (!chosen) {
        throw new ModelError(`${modelKey(model)} is not a model choice.`)
      }
      await conversation.commit(async (tx) => {
        const levels = await familiarDoc(tx, ThinkingLevels, familiar)
        await configure(tx, conversation.id, {
          model: chosen.model,
          thinkingLevel: levelOf(levels, chosen),
        })
      }, context)
    },
    setThinkingLevel: async (level) => {
      await conversation.commit(async (tx) => {
        // Reads before writes: a transaction cannot read tables after writing.
        const agent = await tx.doc(AgentDoc, conversation.id)
        const levels = await familiarDoc(tx, ThinkingLevels, familiar)
        // Startup always leaves the conversation on a model choice.
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
