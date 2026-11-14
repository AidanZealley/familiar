import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Harness } from '@earendil-works/pi-durable'
import { answeredInput } from '../conversation/message.ts'
import { Rooms } from '../rooms/rooms.ts'
import type { FamiliarId } from '../workspace/familiars.ts'
import { memoryApi } from './api.ts'
import { createMemoryExtension } from './extension.ts'
import { createFiling, type FilingOptions } from './filing/task.ts'
import { recallNote } from './recall.ts'
import { Memory } from './store.ts'
import { memoryViews } from './view.ts'

export { MemoryError, type MemoryApi } from './api.ts'
export type {
  JournalLine,
  JournalState,
  MemoryState,
  Note,
  PageState,
  Subject,
} from './store.ts'

export type MemoryOptions = FilingOptions & {
  /** Familiar's clock. */
  now: () => number
}

/**
 * Memory's extensions, to install, and `open`, to call for each Familiar once
 * they are. Nothing runs before the Harness resumes, so it can open before
 * they're installed.
 */
export function createMemory(harness: Harness, options: MemoryOptions) {
  const context = BACKGROUND_CONTEXT
  // In this process for as long as the workspace runs, following its commits.
  const viewOf = memoryViews(harness, options.timeZone, context)
  const filing = createFiling(options)
  const extension = createMemoryExtension({
    viewOf,
    timeZone: options.timeZone,
    recall: async (familiar, model, request) => {
      const view = viewOf(familiar)
      await view.ready()
      return harness.commit(async (tx) => {
        // The input's own words, as sent, so the model copy's header and the
        // room's context, which the next turn may show again, match nothing.
        const query = (await answeredInput(tx, request))?.text ?? model
        await view.catchUp(tx)
        return recallNote(
          view,
          query,
          options.now(),
          await tx.doc(Rooms),
          options.timeZone,
        )
      }, context)
    },
  })

  return {
    extensions: [extension, filing.extension],
    /** Starts `familiar`'s filing and returns its memory. */
    open: async (familiar: FamiliarId) => {
      await harness.commit(async (tx) => {
        await filing.start(tx, familiar)
        // Watches only attach to documents that exist.
        await tx.doc(Memory, String(familiar), null)
      }, context)
      return memoryApi(harness, familiar, viewOf(familiar), options.now)
    },
  }
}
