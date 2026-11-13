import type { Context } from '@earendil-works/chord'
import type {
  CommitPublication,
  DocumentReader,
  EntryId,
  Tx,
} from '@earendil-works/pi-durable'
import { localDay } from '../time.ts'
import type { FamiliarId } from '../workspace/familiars.ts'
import type { DateRange } from './dates.ts'
import {
  entryOf,
  exchangeId,
  transcriptReader,
  type Exchange,
} from './exchanges.ts'
import { createSearchIndex } from './search.ts'
import {
  Journal,
  keyOf,
  Memory,
  Pages,
  readKey,
  type JournalLine,
  type JournalState,
  type MemoryState,
  type Note,
  type PageState,
  type Subject,
} from './store.ts'

/**
 * Memory as search and the prompt read it, kept in this process per
 * Familiar. Exchanges are read from the transcript at the start of each
 * search; pages, journal months and subjects follow Pi's commit
 * publications, so a search never reads a document. After a restart the
 * view loads every page and month once, from snapshots, on first use.
 */

const YEAR = 365 * 24 * 60 * 60 * 1000

/** An exchange's score halves each year since it was said, never below a quarter. */
const recency = (ageMs: number) => Math.max(0.25, 0.5 ** (ageMs / YEAR))

export type Hit =
  | { kind: 'exchange'; exchange: Exchange; lines: readonly JournalLine[] }
  | { kind: 'note'; note: Note; subject: Subject }

export type SearchOptions = {
  now: number
  limit: number
  kind?: 'exchange' | 'note'
  /** Only what covers a day in one of these. */
  ranges?: readonly DateRange[]
  /** Only exchanges whose input comes before this entry: those out of the model's view. */
  before?: EntryId
}

export type MemoryView = ReturnType<typeof createView>

/** Everything search shows, as it is handed in, and the search over it. */
export function createMemoryIndex(timeZone: string) {
  const index = createSearchIndex()
  let subjects = new Map<string, Subject>()
  const pages = new Map<string, PageState>()
  /** Each indexed note's subject. */
  const notes = new Map<string, string>()
  const exchanges: Exchange[] = []
  const positions = new Map<string, number>()
  /** Journal lines by exchange ID, and which exchanges each month holds. */
  const lines = new Map<string, JournalLine[]>()
  const months = new Map<string, Set<string>>()

  const putExchange = (exchange: Exchange) => {
    const keys = lines.get(exchange.id) ?? []
    const day = localDay(exchange.at, timeZone)
    index.put({
      id: exchange.id,
      text: exchange.text,
      keys: keys.map((line) => line.text).join('\n'),
      days: [
        { start: day, end: day },
        ...keys.map((line) => ({ start: line.on, end: line.on })),
      ],
    })
  }

  const setPage = (subject: string, page: Readonly<PageState> | null) => {
    if (page) {
      pages.set(subject, page)
    } else {
      pages.delete(subject)
    }
    const kept = new Set(page?.notes.map((note) => note.id))
    for (const [id, owner] of notes) {
      if (owner === subject && !kept.has(id)) {
        notes.delete(id)
        index.remove(id)
      }
    }
    for (const note of page?.notes ?? []) {
      notes.set(note.id, subject)
      index.put({
        id: note.id,
        text: note.text,
        keys: subjects.get(subject)?.name ?? '',
        days: [{ start: note.since, end: '9999-12-31' }],
      })
    }
  }

  const setMonth = (month: string, journal: Readonly<JournalState> | null) => {
    const byExchange = new Map<string, JournalLine[]>()
    for (const line of journal?.lines ?? []) {
      const id = exchangeId(line.exchange)
      byExchange.set(id, [...(byExchange.get(id) ?? []), line])
    }
    for (const id of new Set([
      ...(months.get(month) ?? []),
      ...byExchange.keys(),
    ])) {
      const next = byExchange.get(id)
      if (JSON.stringify(next) === JSON.stringify(lines.get(id))) {
        continue
      }
      if (next) {
        lines.set(id, next)
      } else {
        lines.delete(id)
      }
      const at = positions.get(id)
      if (at !== undefined) {
        putExchange(exchanges[at])
      }
    }
    months.set(month, new Set(byExchange.keys()))
  }

  const setMemory = (memory: Readonly<MemoryState> | null) => {
    const before = subjects
    subjects = new Map(memory?.subjects.map((subject) => [subject.id, subject]))
    // A renamed subject's notes are found by its new name.
    for (const [id, subject] of subjects) {
      const page = pages.get(id)
      if (page && before.get(id)?.name !== subject.name) {
        setPage(id, page)
      }
    }
  }

  const hitOf = (id: string): Hit | undefined => {
    const at = positions.get(id)
    if (at !== undefined) {
      const exchange = exchanges[at]
      return { kind: 'exchange', exchange, lines: lines.get(id) ?? [] }
    }
    const subject = subjects.get(notes.get(id) ?? '')
    const note =
      subject && pages.get(subject.id)?.notes.find((n) => n.id === id)
    return note && subject && { kind: 'note', note, subject }
  }

  return {
    /** Adds an exchange whose text is final. */
    addExchange(exchange: Exchange) {
      positions.set(exchange.id, exchanges.length)
      exchanges.push(exchange)
      putExchange(exchange)
    },
    setPage,
    setMonth,
    setMemory,
    subjects: () => [...subjects.values()],
    subject: (id: string) => subjects.get(id),
    page: (subject: string) => pages.get(subject),
    /** A note and its subject, or undefined. */
    note: (id: string) => {
      const hit = hitOf(id)
      return hit?.kind === 'note' ? hit : undefined
    },
    /** An exchange and the ones either side of it, if it is indexed. */
    around(id: string) {
      const at = positions.get(id)
      return at === undefined
        ? undefined
        : {
            before: exchanges[at - 1],
            exchange: exchanges[at],
            after: exchanges[at + 1],
          }
    },
    linesOf: (id: string) => lines.get(id) ?? [],

    /** The best matches for `query`, best first: words by relevance, exchanges also by recency. */
    search(query: string, options: SearchOptions): Hit[] {
      const { now, limit, kind, ranges, before } = options
      return index
        .search(query, { kind, ranges })
        .flatMap(({ id, score }): { hit: Hit; score: number }[] => {
          const hit = hitOf(id)
          if (hit?.kind === 'exchange') {
            return before !== undefined && entryOf(id)! >= before
              ? []
              : [{ hit, score: score * recency(now - hit.exchange.at) }]
          }
          return hit ? [{ hit, score }] : []
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ hit }) => hit)
    },

    get size() {
      return index.size
    },
  }
}

/** One Familiar's index, fed from its transcript and its documents' commits. */
function createView(
  familiar: FamiliarId,
  read: DocumentReader,
  timeZone: string,
  context: Context,
) {
  const memory = createMemoryIndex(timeZone)
  const reader = transcriptReader(familiar)

  // Loading from snapshots, once: a document a commit delivered meanwhile
  // is newer than its snapshot, so it is left alone.
  let loading: Promise<void> | undefined
  let delivered: Set<string> | undefined = new Set()

  const load = async () => {
    const state = await read.snapshot(Memory, String(familiar), context)
    if (!delivered!.has('memory')) {
      memory.setMemory(state ?? null)
    }
    for (const { id } of state?.subjects ?? []) {
      const page = await read.snapshot(Pages, keyOf(familiar, id), context)
      if (!delivered!.has(`page:${id}`)) {
        memory.setPage(id, page ?? null)
      }
    }
    for (const month of state?.months ?? []) {
      const journal = await read.snapshot(
        Journal,
        keyOf(familiar, month),
        context,
      )
      if (!delivered!.has(`journal:${month}`)) {
        memory.setMonth(month, journal ?? null)
      }
    }
    delivered = undefined
  }

  return Object.assign(memory, {
    /** Loads pages and journal after a restart. Call it outside a commit. */
    ready: () => (loading ??= load()),

    /** Applies a commit's change to one of this Familiar's documents. */
    apply(kind: string, own: string | undefined, value: unknown) {
      if (kind === Memory.definition.kind) {
        delivered?.add('memory')
        memory.setMemory(value as MemoryState | null)
      } else if (kind === Pages.definition.kind) {
        delivered?.add(`page:${own}`)
        memory.setPage(own!, value as PageState | null)
      } else {
        delivered?.add(`journal:${own}`)
        memory.setMonth(own!, value as JournalState | null)
      }
    },

    /** Brings exchanges up to date with the transcript, in a commit's reads. */
    catchUp: (tx: Tx) => reader.read(tx, memory.addExchange),

    /** The first entry the model sees verbatim, as of the last catch-up. */
    viewStart: () => reader.viewStart,
  })
}

/** Each open Familiar's view, made on first use, following `observer`'s commits. */
export function memoryViews(
  observer: DocumentReader & {
    subscribeCommits(
      listener: (publication: CommitPublication) => void,
    ): () => void
  },
  timeZone: string,
  context: Context,
) {
  const views = new Map<FamiliarId, MemoryView>()
  const kinds = new Set([
    Memory.definition.kind,
    Pages.definition.kind,
    Journal.definition.kind,
  ])

  observer.subscribeCommits(({ changes }) => {
    for (const change of changes) {
      if (
        change.type !== 'document' ||
        !kinds.has(change.record.kind) ||
        change.record.key === undefined
      ) {
        continue
      }
      const { kind, key } = change.record
      const { familiar, own } =
        kind === Memory.definition.kind
          ? { familiar: Number(key) as FamiliarId, own: undefined }
          : readKey(key)
      views.get(familiar)?.apply(kind, own, change.value)
    }
  })

  return (familiar: FamiliarId) => {
    let view = views.get(familiar)
    if (!view) {
      view = createView(familiar, observer, timeZone, context)
      views.set(familiar, view)
    }
    return view
  }
}

export type ViewOf = ReturnType<typeof memoryViews>
