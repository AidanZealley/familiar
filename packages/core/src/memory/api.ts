import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { DocumentWatch, Harness } from '@earendil-works/pi-durable'
import { Memory } from './memory.ts'
import {
  forgetFact,
  retireFact,
  reviseFact,
  setCore,
  type MemoryState,
} from './facts.ts'

/** The owner's corrections. Each rejects, changing nothing, when the fact is missing or already past. */
export type MemoryApi = {
  watch(): Promise<DocumentWatch<MemoryState>>
  revise(id: string, text: string): Promise<void>
  retire(id: string): Promise<void>
  /** Put a fact in core or take it out, regardless of core's budget. */
  setCore(id: string, core: boolean): Promise<void>
  forget(id: string): Promise<void>
}

const context = BACKGROUND_CONTEXT

export function memoryApi(harness: Harness): MemoryApi {
  const editMemory = (edit: (memory: MemoryState) => void) =>
    harness.commit(async (tx) => edit(await tx.doc(Memory)), context)

  return {
    watch: async () => (await harness.watchDoc(Memory, context))!,
    revise: (id, text) =>
      editMemory((memory) => void reviseFact(memory, id, text, Date.now())),
    retire: (id) => editMemory((memory) => retireFact(memory, id, Date.now())),
    setCore: (id, core) => editMemory((memory) => setCore(memory, id, core)),
    forget: (id) => editMemory((memory) => forgetFact(memory, id)),
  }
}
