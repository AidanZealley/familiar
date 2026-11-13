import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { DocumentWatch, Harness } from '@earendil-works/pi-durable'
import type { FamiliarId } from '../workspace/familiars.ts'
import { renderSection } from './section.ts'
import {
  keyOf,
  Memory,
  Pages,
  type MemoryState,
  type PageState,
} from './store.ts'
import type { MemoryView } from './view.ts'

/** A change memory refuses, such as forgetting a note that isn't there; nothing changed. */
export class MemoryError extends Error {}

/** What people see of a Familiar's memory, and the one change they make to it. */
export type MemoryApi = {
  /** Its subjects, then every change: the roster and what each page is. */
  watch(): Promise<DocumentWatch<MemoryState>>
  /** A subject's page: its profile and notes. Rejects for no such subject. */
  page(subject: string): Promise<PageState>
  /** The memory section of the prompt, exactly as the model sees it now. */
  section(): Promise<string>
  /**
   * Forgets a note: removes its words and quote, keeping a marker, and
   * records its source messages so filing never writes from them again.
   * Its page's profile is cleared until consolidation writes it again
   * without the note. Rejects for no such note.
   */
  forget(note: string): Promise<void>
}

const context = BACKGROUND_CONTEXT

/** `familiar`'s memory, read through its view. `now` is Familiar's clock. */
export function memoryApi(
  harness: Harness,
  familiar: FamiliarId,
  view: MemoryView,
  now: () => number,
): MemoryApi {
  return {
    // Opening creates the document, so a watch always attaches.
    watch: async () =>
      (await harness.watchDoc(Memory, String(familiar), context))!,
    page: async (subject) => {
      await view.ready()
      if (!view.subject(subject)) {
        throw new MemoryError(`No subject ${subject}.`)
      }
      return (
        (await harness.snapshot(Pages, keyOf(familiar, subject), context)) ?? {
          profile: '',
          notes: [],
        }
      )
    },
    section: async () => {
      await view.ready()
      return renderSection(view)
    },
    forget: async (id) => {
      await view.ready()
      const subject = view.note(id)?.subject.id
      await harness.commit(async (tx) => {
        const memory = await tx.doc(Memory, String(familiar), null)
        const entry = memory.subjects.find((each) => each.id === subject)
        const page =
          entry && (await tx.doc(Pages, keyOf(familiar, entry.id), null))
        const note = page?.notes.find((note) => note.id === id)
        if (!entry || !page || !note || note.retired?.reason === 'forgotten') {
          throw new MemoryError(`No note ${id}.`)
        }
        note.text = ''
        note.quote = ''
        note.retired = { reason: 'forgotten', at: now() }
        memory.forgotten = [
          ...new Set([...memory.forgotten, ...note.sources]),
        ].sort((a, b) => a - b)
        // The profile may say what was forgotten: gone until rewritten.
        page.profile = ''
        entry.changed = now()
      }, context)
    },
  }
}
