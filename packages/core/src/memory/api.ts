import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { DocumentWatch, Harness } from '@earendil-works/pi-durable'
import { Memory, type MemoryState } from './memory.ts'
import { forgetFact, reviseFact } from './edits.ts'

export type MemoryApi = {
  watch(): Promise<DocumentWatch<MemoryState>>
  revise(id: string, text: string): Promise<void>
  forget(id: string): Promise<void>
}

const context = BACKGROUND_CONTEXT

export function memoryApi(harness: Harness): MemoryApi {
  const editMemory = (edit: (memory: MemoryState) => void) =>
    harness.commit(async (tx) => edit(await tx.doc(Memory)), context)

  return {
    watch: async () => (await harness.watchDoc(Memory, context))!,
    revise: (id, text) =>
      editMemory((memory) => {
        Object.assign(memory, reviseFact(memory, id, text, Date.now()))
      }),
    forget: (id) =>
      editMemory((memory) => {
        Object.assign(memory, forgetFact(memory, id))
      }),
  }
}
