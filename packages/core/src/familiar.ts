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
import { TimeExtension } from './time/index.ts'

// The types in Familiar's own signatures, so hosts can name them.
export type { HistoryPage, Message } from './conversation/index.ts'
export type { MemoryApi } from './memory/index.ts'
export type { UsageState as Usage } from '@earendil-works/pi-durable'

export type FamiliarOptions = {
  storage: Storage
  models: Models
  model: ModelRef
  name?: string
  extensions?: Extension[]
  /**
   * Roughly how many tokens each request may send, whatever the model's context
   * window; older conversation is compacted into a summary to stay under it.
   * Higher keeps more conversation verbatim, but every request pays for all of
   * it, in money or subscription limits, latency and the model's attention.
   * Default 64,000.
   */
  contextBudget?: number
  now?: HarnessOptions['now']
  setTimer?: HarnessOptions['setTimer']
}

/**
 * A Familiar is one assistant with one owner and one never-ending conversation.
 * A host that serves many owners (households, users) opens one Familiar each.
 */
export type Familiar = ConversationApi & {
  memory: MemoryApi
  /**
   * Called after every commit. Listeners run synchronously, so keep them quick
   * and don't call back into Familiar. Returns a function that stops listening.
   */
  onCommit(listener: () => void): () => void
  usage(): Promise<UsageState>
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

  // Extensions can be installed after opening: nothing runs until resume().
  const registry = createRegistry()

  const harness = await Harness.open(
    options.storage,
    harnessOptions(options, registry, budget),
    context,
  )

  // Half the budget leaves room for the prompt, memory and the pass's tool calls.
  const memory = createMemory(harness, {
    now: options.now ?? Date.now,
    model: options.model,
    name,
    transcriptTokens: Math.floor(budget / 2),
  })

  const extensions = [
    createPersona(name),
    TimeExtension,
    ...memory.extensions,
    ...(options.extensions ?? []),
  ]

  for (const extension of extensions) {
    registry.install(extension)
  }

  const conversation = await installConversation(harness, options.model)
  const memoryActions = await memory.start()

  // finish whatever the last process left unfinished
  harness.resume()

  return {
    ...conversation,
    memory: memoryActions,
    onCommit: (listener) => harness.subscribeCommits(() => listener()),
    usage: () => harness.usage(context),
    dismiss: () => harness.close(context),
  }
}
