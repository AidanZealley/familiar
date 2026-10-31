import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Models, ModelThinkingLevel } from '@earendil-works/pi-ai'
import {
  AgentDoc,
  configure,
  type ConversationWatch,
  type Cursor,
  type EntryId,
  type EntryRecord,
  type Harness,
  type ModelRef,
} from '@earendil-works/pi-durable'
import { formatMessage, MESSAGE_KIND } from './message.ts'
import {
  findChatModel,
  ModelError,
  modelKey,
  modelOptions,
  ThinkingLevels,
  type ChatModel,
  type ModelOption,
  type ThinkingLevelsState,
} from './models.ts'

/** One message from a person. Hosts authenticate; Familiar only records who spoke. */
export type Message = {
  /**
   * Who sent it, as the host names them. The model sees it on the message, so
   * pick a label it can address, such as a first name. It attributes words;
   * it grants nothing.
   */
  author: string
  text: string
  /** Stable per logical message, so a retried send is admitted once. */
  requestId: string
}

export type HistoryPage = { entries: EntryRecord[]; more: boolean }

export type ConversationApi = {
  send(message: Message): Promise<void>
  /** Stop the current run and withdraw the messages queued behind it. */
  abort(): Promise<void>
  /** Resolves once nothing is running: every sent message is answered. */
  idle(): Promise<void>
  /** The conversation's committed view, then every commit's changes to it. */
  watch(): Promise<ConversationWatch>
  /**
   * Up to `limit` committed entries older than entry `before`, newest first,
   * including those compaction took out of the view. `more` says whether
   * older ones exist.
   */
  history(before: EntryId, limit: number): Promise<HistoryPage>
  /**
   * The models the conversation may switch to. Which it's on, and at what
   * level, is the view's `pi.agent` document.
   */
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
  model: ModelRef
  chatModels: readonly ChatModel[]
}

const context = BACKGROUND_CONTEXT

/** `chatModel`'s level: the one last picked for it, else its default. */
const levelOf = (levels: ThinkingLevelsState, chatModel: ChatModel) =>
  levels[modelKey(chatModel.model)] ?? chatModel.thinkingLevel

export async function installConversation(
  harness: Harness,
  { models, model, chatModels }: ConversationOptions,
): Promise<ConversationApi> {
  // Every chat model resolved once, so a catalog missing one fails at startup.
  const options = modelOptions(models, chatModels)
  const fallback = findChatModel(options, model)
  if (!fallback) {
    throw new Error(`${modelKey(model)} must be one of the chat models.`)
  }

  const conversation = await harness.root(context)
  // The conversation owns its model and level. A new one, or one whose model
  // is no longer offered, starts on the fallback.
  await conversation.commit(async (tx) => {
    const agent = await tx.doc(AgentDoc, conversation.id)
    const levels = await tx.doc(ThinkingLevels)
    const kept = findChatModel(options, agent.model)
    const chosen = kept ?? fallback
    await configure(tx, conversation.id, {
      model: chosen.model,
      thinkingLevel: (kept && agent.thinkingLevel) ?? levelOf(levels, chosen),
    })
  }, context)

  return {
    send: async ({ author, text, requestId }) => {
      // The model's copy names the author; the entry keeps the words as sent.
      await conversation.submit(
        {
          type: 'input',
          content: formatMessage({ author, text }),
          requestId,
          entry: { kind: MESSAGE_KIND, data: { author, text } },
        },
        context,
      )
    },
    abort: async () => {
      await conversation.abort(context)
    },
    idle: () => conversation.waitForIdle(context),
    watch: () => conversation.watch(context),
    history: async (before, limit) => {
      // Entry IDs are ascending integers, and the bound is inclusive.
      const query = { maxEntryId: (before - 1) as EntryId }
      const entries: EntryRecord[] = []

      let cursor: Cursor | undefined

      // One past the limit tells whether more exist.
      do {
        const page = await conversation.entries(
          query,
          limit + 1 - entries.length,
          cursor,
          context,
        )
        entries.push(...page.items)
        cursor = page.next
      } while (cursor && entries.length <= limit)

      return {
        entries: entries.slice(0, limit),
        more: entries.length > limit,
      }
    },
    models: () => options,
    setModel: async (model) => {
      const chosen = findChatModel(options, model)
      if (!chosen) {
        throw new ModelError(`${modelKey(model)} is not a chat model.`)
      }
      await conversation.commit(async (tx) => {
        const levels = await tx.doc(ThinkingLevels)
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
        const levels = await tx.doc(ThinkingLevels)
        // Startup always leaves the conversation on a chat model.
        const current = findChatModel(options, agent.model)!
        if (!current.thinkingLevels.includes(level)) {
          throw new ModelError(`${current.name} has no ${level} reasoning.`)
        }
        levels[modelKey(current.model)] = level
        await configure(tx, conversation.id, { thinkingLevel: level })
      }, context)
    },
  }
}
