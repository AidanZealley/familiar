import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { DocumentWatch, Harness } from '@earendil-works/pi-durable'
import { localDay } from '../time/index.ts'
import { Episodes, type EpisodesState } from './episodes.ts'
import {
  Facts,
  openMemory,
  retireFact,
  reviseFact,
  setPinned,
  type FactsState,
  type Memory,
} from './facts.ts'

/** The owner's corrections. Each rejects, changing nothing, when the fact is missing or already past. */
export type MemoryApi = {
  watch(): Promise<DocumentWatch<FactsState>>
  /** Summaries of what happened, written by nightly upkeep. */
  watchEpisodes(): Promise<DocumentWatch<EpisodesState>>
  /** Saves a new version, true from today. The owner's word is its source. */
  revise(id: string, text: string): Promise<void>
  /** Marks a fact no longer true from today. */
  retire(id: string): Promise<void>
  /** Pin a fact into core, or unpin it so rebalancing decides. Rejects when the pinned facts alone would pass core's budget. */
  setPinned(id: string, pinned: boolean): Promise<void>
}

const context = BACKGROUND_CONTEXT

/** `now` is Familiar's clock, so the owner's edits are dated like everything else. */
export function memoryApi(harness: Harness, now: () => number): MemoryApi {
  const editMemory = (edit: (memory: Memory) => void) =>
    harness.commit(async (tx) => edit(await openMemory(tx)), context)

  return {
    // Memory's start() creates the documents, so a watch always attaches.
    watch: async () => (await harness.watchDoc(Facts, context))!,
    watchEpisodes: async () => (await harness.watchDoc(Episodes, context))!,
    revise: (id, text) =>
      editMemory((memory) =>
        reviseFact(memory, id, { text, since: localDay(now()) }, now()),
      ),
    retire: (id) =>
      editMemory((memory) => retireFact(memory, id, localDay(now()))),
    setPinned: (id, pinned) =>
      editMemory((memory) => setPinned(memory, id, pinned)),
  }
}
