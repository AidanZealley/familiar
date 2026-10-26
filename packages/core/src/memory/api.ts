import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { DocumentWatch, Harness } from '@earendil-works/pi-durable'
import { Episodes, type EpisodesState } from './episodes.ts'
import { Memory } from './memory.ts'
import {
  forgetFact,
  retireFact,
  reviseFact,
  setPinned,
  type MemoryState,
} from './facts.ts'

/** The owner's corrections. Each rejects, changing nothing, when the fact is missing or already past. */
export type MemoryApi = {
  watch(): Promise<DocumentWatch<MemoryState>>
  /** Summaries of what happened, written by nightly upkeep. */
  watchEpisodes(): Promise<DocumentWatch<EpisodesState>>
  revise(id: string, text: string): Promise<void>
  retire(id: string): Promise<void>
  /** Pin a fact into core, or unpin it so rebalancing decides. Rejects when core is full. */
  setPinned(id: string, pinned: boolean): Promise<void>
  forget(id: string): Promise<void>
}

const context = BACKGROUND_CONTEXT

export function memoryApi(harness: Harness): MemoryApi {
  const editMemory = (edit: (memory: MemoryState) => void) =>
    harness.commit(async (tx) => edit(await tx.doc(Memory)), context)

  return {
    watch: async () => (await harness.watchDoc(Memory, context))!,
    watchEpisodes: async () => (await harness.watchDoc(Episodes, context))!,
    revise: (id, text) =>
      editMemory((memory) => void reviseFact(memory, id, text, Date.now())),
    retire: (id) => editMemory((memory) => retireFact(memory, id, Date.now())),
    setPinned: (id, pinned) =>
      editMemory((memory) => setPinned(memory, id, pinned)),
    forget: (id) => editMemory((memory) => forgetFact(memory, id)),
  }
}
