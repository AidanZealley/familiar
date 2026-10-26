import { createHistoryExtension, MESSAGE_KIND } from './conversation/index.ts'
export { MESSAGE_KIND, type MessageData } from './conversation/message.ts'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Models } from '@earendil-works/pi-ai'
import {
  createRegistry,
  Harness,
  type CompactionSettings,
  type Cursor,
  type ConversationWatch,
  type DocumentWatch,
  type EntryId,
  type EntryRecord,
  type Extension,
  type HarnessOptions,
  type ModelRef,
  type Storage,
} from '@earendil-works/pi-durable'
import {
  createUpkeep,
  reviseFact,
  forgetFact,
  Memory,
  MemoryExtension,
  type MemoryState,
} from './memory/index.ts'
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
  /** The clock, for tests and hosts with their own; default `Date.now`. */
  now?: HarnessOptions['now']
  /** Arms timers on that clock; default `setTimeout`. */
  setTimer?: HarnessOptions['setTimer']
}

/** One message from a person. Hosts authenticate; Familiar only records who spoke. */
export type Message = {
  author: string
  text: string
  /** Stable per logical message, so a retried send is admitted once. */
  requestId: string
}

/**
 * A Familiar is one assistant with one owner and one never-ending conversation.
 * A host that serves many owners (households, users) opens one Familiar each.
 */
export type Familiar = {
  send(message: Message): Promise<void>
  /** Stop the current run and withdraw the messages queued behind it. */
  abort(): Promise<void>
  /** Resolves once nothing is running: every sent message is answered. */
  idle(): Promise<void>
  /** The conversation's committed view, then every commit's changes to it. */
  watch(): Promise<ConversationWatch>
  /**
   * Called after every commit: any change to the conversation, memory or
   * background work. Returns a function that stops listening. Listeners run
   * synchronously, so keep them quick and don't call back into Familiar.
   */
  onCommit(listener: () => void): () => void
  /**
   * Up to `limit` committed entries older than entry `before`, newest first,
   * including those compaction took out of the view. `more` says whether
   * older ones exist.
   */
  history(before: EntryId, limit: number): Promise<HistoryPage>
  /** What it remembers. The model keeps it; people can correct it. */
  memory: {
    watch(): Promise<DocumentWatch<MemoryState>>
    revise(id: string, text: string): Promise<void>
    forget(id: string): Promise<void>
  }
  close(): Promise<void>
}

export type HistoryPage = { entries: EntryRecord[]; more: boolean }

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
  const name = options.name ?? 'Familiar'
  const budget = options.contextBudget ?? DEFAULT_CONTEXT_BUDGET
  // Half the budget leaves room for the prompt, memory and the pass's tool calls.
  const upkeep = createUpkeep({
    model: options.model,
    name,
    transcriptTokens: Math.floor(budget / 2),
  })
  const registry = createRegistry()
  registry.install(createPersona(name))
  registry.install(MemoryExtension)
  registry.install(upkeep.extension)
  for (const extension of options.extensions ?? []) registry.install(extension)

  // Looked up at each open, so a change of model gets its own thresholds.
  const window = options.models.getModel(
    options.model.provider,
    options.model.modelId,
  )?.contextWindow
  const compaction = window ? compactionFor(window, budget) : undefined

  const harness = await Harness.open(
    options.storage,
    {
      models: options.models,
      registry,
      settings: { compaction },
      ...(options.now && { now: options.now }),
      ...(options.setTimer && { setTimer: options.setTimer }),
    },
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
  await upkeep.start(harness, context)
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
    onCommit: (listener) => harness.subscribeCommits(() => listener()),
    async history(before, limit) {
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
      return { entries: entries.slice(0, limit), more: entries.length > limit }
    },
    memory: {
      watch: async () => (await harness.watchDoc(Memory, context))!,
      revise: (id, text) =>
        editMemory((memory) => {
          Object.assign(memory, reviseFact(memory, id, text, Date.now()))
        }),
      forget: (id) =>
        editMemory((memory) => {
          Object.assign(memory, forgetFact(memory, id))
        }),
    },
    close: () => harness.close(context),
  }
}
