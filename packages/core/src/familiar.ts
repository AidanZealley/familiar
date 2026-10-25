import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Models } from '@earendil-works/pi-ai'
import {
  createRegistry,
  Harness,
  type CompactionSettings,
  type ConversationWatch,
  type DocumentWatch,
  type Extension,
  type ModelRef,
  type Storage,
} from '@earendil-works/pi-durable'
import {
  createHistoryExtension,
  Memory,
  MemoryExtension,
  type MemoryState,
} from '@familiar/memory'
import { createPersona } from './persona.ts'

export type FamiliarOptions = {
  /** Where everything Familiar knows is kept. One host process owns it at a time. */
  storage: Storage
  /** The host's model collection, with its providers and credentials configured. */
  models: Models
  model: ModelRef
  /** What the assistant calls itself. */
  name?: string
  /** Host-specific tools and behaviour, installed after Familiar's own. */
  extensions?: Extension[]
  /**
   * Roughly how many tokens each request may send, whatever the model's context
   * window; older conversation is compacted into a summary to stay under it.
   * Higher keeps more conversation verbatim, but every request pays for all of
   * it, in money or subscription limits, latency and the model's attention.
   * Default 64,000.
   */
  contextBudget?: number
}

/** One message from a person. Hosts authenticate; Familiar only records who spoke. */
export type Message = {
  author: string
  text: string
  /** Stable per logical message, so a retried send is admitted once. */
  requestId: string
}

/** The entry kind people's messages are stored as. */
export const MESSAGE_KIND = 'familiar.message'

export type MessageData = { author: string; text: string }

/**
 * A Familiar is one assistant with one owner and one never-ending conversation.
 * A host that serves many owners (households, users) opens one Familiar each.
 */
export type Familiar = {
  send(message: Message): Promise<void>
  /** Stop the current run. Queued messages stay queued. */
  abort(): Promise<void>
  /** Resolves once nothing is running: every sent message is answered. */
  idle(): Promise<void>
  /** The conversation's committed view, then every commit's changes to it. */
  watch(): Promise<ConversationWatch>
  /** What it remembers. The model keeps it; people can correct it. */
  memory: {
    watch(): Promise<DocumentWatch<MemoryState>>
    revise(id: string, text: string): Promise<void>
    forget(id: string): Promise<void>
  }
  close(): Promise<void>
}

const context = BACKGROUND_CONTEXT

const DEFAULT_CONTEXT_BUDGET = 64_000

/**
 * Compaction thresholds that keep requests under `budget`. Pi measures from
 * the top of the window, so the budget becomes the room reserved below it.
 * A window smaller than the budget keeps a quarter of itself free instead.
 */
export function compactionFor(
  contextWindow: number,
  budget: number,
): CompactionSettings {
  const limit = Math.min(budget, Math.floor(contextWindow * 0.75))
  return {
    // Above `contextWindow - reserveTokens`, the next request waits to compact.
    reserveTokens: contextWindow - limit,
    // What stays verbatim after compacting, leaving room to grow before the next.
    keepRecentTokens: Math.floor(limit / 3),
    // Starts compacting in the background at three quarters of the limit, so a
    // request rarely has to wait for it.
    backgroundTokens: Math.floor(limit / 4),
  }
}

export async function openFamiliar(
  options: FamiliarOptions,
): Promise<Familiar> {
  const registry = createRegistry()
  registry.install(createPersona(options.name ?? 'Familiar'))
  registry.install(MemoryExtension)
  for (const extension of options.extensions ?? []) registry.install(extension)

  // Looked up at each open, so a change of model gets its own thresholds.
  const window = options.models.getModel(
    options.model.provider,
    options.model.modelId,
  )?.contextWindow
  const compaction = window
    ? compactionFor(window, options.contextBudget ?? DEFAULT_CONTEXT_BUDGET)
    : undefined

  const harness = await Harness.open(
    options.storage,
    { models: options.models, registry, settings: { compaction } },
    context,
  )
  const conversation = await harness.root(context, {
    agent: { model: options.model },
  })
  // A configured model wins over the one the conversation was created with.
  await conversation.configure({ model: options.model }, context)
  // Needs the conversation, so it joins once that exists, before any work runs.
  registry.install(createHistoryExtension(conversation))
  // Watches only attach to documents that exist.
  await harness.commit((tx) => tx.doc(Memory), context)
  harness.resume() // finish whatever the last process left unfinished

  const editMemory = (edit: (memory: MemoryState) => void) =>
    harness.commit(async (tx) => edit(await tx.doc(Memory)), context)

  return {
    async send({ author, text, requestId }) {
      await conversation.submit(
        {
          type: 'input',
          content: text,
          requestId,
          entry: { kind: MESSAGE_KIND, data: { author, text } },
        },
        context,
      )
    },
    async abort() {
      await conversation.abort(context)
    },
    idle: () => conversation.waitForIdle(context),
    watch: () => conversation.watch(context),
    memory: {
      watch: async () => (await harness.watchDoc(Memory, context))!,
      revise: (id, text) =>
        editMemory((memory) => {
          const fact = memory.facts.find((fact) => fact.id === id)
          if (fact) Object.assign(fact, { text, at: Date.now() })
        }),
      forget: (id) =>
        editMemory((memory) => {
          memory.facts = memory.facts.filter((fact) => fact.id !== id)
        }),
    },
    close: () => harness.close(context),
  }
}
