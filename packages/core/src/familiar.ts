import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Models } from '@earendil-works/pi-ai'
import {
  createRegistry,
  Harness,
  type Extension,
  type HarnessOptions,
  type ModelRef,
  type Storage,
  type UsageState,
} from '@earendil-works/pi-durable'
import { DEFAULT_CONTEXT_BUDGET, harnessOptions } from './context/index.ts'
import {
  installConversation,
  type ConversationApi,
} from './conversation/index.ts'
import { createMemory, type MemoryApi } from './memory/index.ts'
import { createPersona } from './persona/index.ts'

export { compactionFor } from './context/index.ts'
export { MESSAGE_KIND, type MessageData } from './conversation/message.ts'
export type { Message, HistoryPage } from './conversation/api.ts'
export type { UsageState as Usage } from '@earendil-works/pi-durable'

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

/**
 * A Familiar is one assistant with one owner and one never-ending conversation.
 * A host that serves many owners (households, users) opens one Familiar each.
 */
export type Familiar = ConversationApi & {
  /**
   * Called after every commit: any change to the conversation, memory or
   * background work. Returns a function that stops listening. Listeners run
   * synchronously, so keep them quick and don't call back into Familiar.
   */
  onCommit(listener: () => void): () => void
  /**
   * Tokens and cost spent so far, per model and per tool, across everything
   * it has done: replies, compaction summaries and memory upkeep.
   */
  usage(): Promise<UsageState>
  /** What it remembers. The model keeps it; people can correct it. */
  memory: MemoryApi
  /** Lets it go: finishes committing, then releases its storage. Summon again to resume. */
  dismiss(): Promise<void>
}

/**
 * Opens a Familiar over its storage, resuming whatever it was doing, and
 * starts its background work. One process per storage; `dismiss()` it when done.
 */
export async function summonFamiliar(
  options: FamiliarOptions,
): Promise<Familiar> {
  const context = BACKGROUND_CONTEXT
  const name = options.name ?? 'Familiar'
  const budget = options.contextBudget ?? DEFAULT_CONTEXT_BUDGET
  // Half the budget leaves room for the prompt, memory and the pass's tool calls.
  const memory = createMemory({
    model: options.model,
    name,
    transcriptTokens: Math.floor(budget / 2),
  })
  const registry = createRegistry()
  for (const extension of [
    createPersona(name),
    ...memory.extensions,
    ...(options.extensions ?? []),
  ])
    registry.install(extension)
  const harness = await Harness.open(
    options.storage,
    harnessOptions(options, registry, budget),
    context,
  )
  const conversation = await installConversation(
    harness,
    registry,
    options.model,
  )
  const memoryActions = await memory.start(harness)
  harness.resume() // finish whatever the last process left unfinished
  return {
    ...conversation,
    memory: memoryActions,
    onCommit: (listener) => harness.subscribeCommits(() => listener()),
    usage: () => harness.usage(context),
    dismiss: () => harness.close(context),
  }
}
