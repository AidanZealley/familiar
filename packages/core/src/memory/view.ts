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
import { createSearchIndex, hasTerms, type SearchIndex } from './search.ts'
import {
  isCurrent,
  Journal,
  keyOf,
  Memory,
  normalized,
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
 * Memory as search and the prompt read it: a view of one Familiar's
 * transcript, pages and journal, kept in this process. Exchanges are read
 * from the transcript at the start of each search. Pages, journal months and
 * the subject list follow Pi's commit publications, which carry each
 * changed document's new value, so a search never reads a document and
 * never rebuilds anything. After a restart the view loads every page and
 * month once, from snapshots, on first use.
 */

const YEAR = 365 * 24 * 60 * 60 * 1000

/** How a search ranks what matches: relevance × recency, with boosts. */
export const RANKING = {
  /** Halves each year since it was said, never below a quarter. */
  recency: (ageMs: number) => Math.max(0.25, 0.5 ** (ageMs / YEAR)),
  /** A note no longer current ranks below a current one that matches as well. */
  past: 0.6,
  /** Added to a note on, or naming, a subject the query names. */
  subject: 4,
}

export type Hit =
  | {
      kind: 'exchange'
      exchange: Exchange
      /** Its journal lines, the keys that also find it. */
      lines: readonly JournalLine[]
    }
  | { kind: 'note'; note: Note; subject: Subject }

export type SearchOptions = {
  now: number
  limit: number
  offset?: number
  kind?: 'exchange' | 'note'
  /**
   * Days to search. `filter` keeps only what covers one of them; `prefer`
   * ranks it first, then what matches the query outside them.
   */
  ranges?: readonly DateRange[]
  dates?: 'filter' | 'prefer'
  /** Only what is on, or names, one of these subjects. */
  about?: readonly string[]
  /** Only exchanges whose input comes before this entry: those out of the model's view. */
  before?: EntryId
  /** Only current notes. */
  current?: boolean
}

export type Found = { hits: Hit[]; total: number }

/** An open Familiar's view. */
export type MemoryView = ReturnType<typeof createView>

const ALWAYS = '9999-12-31'

const noteSignature = (note: Note) =>
  JSON.stringify([
    note.text,
    note.since,
    note.until,
    note.mentions,
    note.retired,
  ])

/**
 * The index and everything search shows, in memory: exchanges, pages and
 * journal lines as they are handed to it, and the ranking. Knows nothing of
 * where they come from.
 */
export function createMemoryIndex(timeZone: string) {
  const index: SearchIndex = createSearchIndex()

  let subjects = new Map<string, Subject>()
  const pages = new Map<string, PageState>()
  /** Each note's page, and what it was indexed as. */
  const notes = new Map<string, { subject: string; signature: string }>()
  /** Exchanges in transcript order, and where each is. */
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
      subjects: [...new Set(keys.flatMap((line) => line.subjects))],
    })
  }

  const setPage = (subject: string, page: Readonly<PageState> | null) => {
    if (page) {
      pages.set(subject, page)
    } else {
      pages.delete(subject)
    }
    const kept = new Set<string>()
    for (const note of page?.notes ?? []) {
      // Forgotten notes are only markers: nothing left to find.
      if (note.retired?.reason === 'forgotten') {
        continue
      }
      kept.add(note.id)
      const signature = noteSignature(note)
      if (notes.get(note.id)?.signature === signature) {
        continue
      }
      notes.set(note.id, { subject, signature })
      index.put({
        id: note.id,
        text: note.text,
        keys: '',
        days: [{ start: note.since, end: note.until ?? ALWAYS }],
        subjects: [subject, ...note.mentions],
      })
    }
    for (const [id, owner] of notes) {
      if (owner.subject === subject && !kept.has(id)) {
        notes.delete(id)
        index.remove(id)
      }
    }
  }

  const setMonth = (month: string, journal: Readonly<JournalState> | null) => {
    const before = months.get(month) ?? new Set<string>()
    const byExchange = new Map<string, JournalLine[]>()
    for (const line of journal?.lines ?? []) {
      const id = exchangeId(line.exchange)
      byExchange.set(id, [...(byExchange.get(id) ?? []), line])
    }
    for (const id of new Set([...before, ...byExchange.keys()])) {
      const next = byExchange.get(id)
      const previous = lines.get(id)
      if (JSON.stringify(next) === JSON.stringify(previous)) {
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
    subjects = new Map(memory?.subjects.map((subject) => [subject.id, subject]))
  }

  /** The subjects `query` names by name or alias, as whole words. */
  const named = (query: string) => {
    const text = ` ${normalized(query)} `
    return [...subjects.values()].flatMap((subject) =>
      [subject.name, ...subject.aliases].some((name) => {
        const words = normalized(name)
        return words && text.includes(` ${words} `)
      })
        ? [subject.id]
        : [],
    )
  }

  const hitOf = (id: string): Hit | undefined => {
    const at = positions.get(id)
    if (at !== undefined) {
      return {
        kind: 'exchange',
        exchange: exchanges[at],
        lines: lines.get(id) ?? [],
      }
    }
    const owner = notes.get(id)
    const subject = owner && subjects.get(owner.subject)
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
      index.mark(exchange.last)
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
    /** Subjects `query` names. */
    named,

    /** Ranked matches for `query`, and how many there are in all. */
    search(query: string, options: SearchOptions): Found {
      const { now, limit, offset = 0, kind, about, before } = options
      const ranges = options.ranges?.length ? options.ranges : undefined
      const base = { kind, about }
      const scores = new Map<string, number>()
      const inRange = new Set<string>()
      const add = (id: string, score: number) =>
        scores.set(id, Math.max(scores.get(id) ?? 0, score))

      if (ranges && options.dates === 'filter') {
        for (const { id, score } of index.search(query, { ...base, ranges })) {
          add(id, score)
        }
      } else {
        // Every match, then everything on the days asked for, matching or not.
        for (const { id, score } of index.search(query, base)) {
          add(id, score)
        }
        if (ranges) {
          for (const { id } of index.search('', { ...base, ranges })) {
            inRange.add(id)
            add(id, 0)
          }
        }
      }
      // Notes on a subject the query names, even without its words, unless
      // the search is already about given subjects.
      if (kind !== 'exchange' && !about?.length && hasTerms(query)) {
        const subjectsNamed = named(query)
        if (subjectsNamed.length) {
          for (const { id } of index.search('', {
            kind: 'note',
            about: subjectsNamed,
            ...(ranges && options.dates === 'filter' && { ranges }),
          })) {
            add(id, (scores.get(id) ?? 0) + RANKING.subject)
          }
        }
      }

      type Ranked = { hit: Hit; tier: number; score: number }
      const ranked = [...scores].flatMap(([id, score]): Ranked[] => {
        const hit = hitOf(id)
        if (!hit) {
          return []
        }
        if (hit.kind === 'exchange') {
          const entry = entryOf(id)!
          if (before !== undefined && entry >= before) {
            return []
          }
          return [
            {
              hit,
              tier: tier(id),
              score: score * RANKING.recency(now - hit.exchange.at),
            },
          ]
        }
        if (options.current && !isCurrent(hit.note)) {
          return []
        }
        return [
          {
            hit,
            tier: tier(id),
            score: score * (isCurrent(hit.note) ? 1 : RANKING.past),
          },
        ]
      })
      function tier(id: string) {
        // Preferred dates: in range with the query's words, in range, then the rest.
        if (!ranges || options.dates === 'filter') {
          return 0
        }
        const dated = inRange.has(id)
        return dated ? (scores.get(id)! > 0 ? 0 : 1) : 2
      }
      ranked.sort((a, b) => a.tier - b.tier || b.score - a.score)
      return {
        hits: ranked.slice(offset, offset + limit).map(({ hit }) => hit),
        total: ranked.length,
      }
    },

    /** How many exchanges and notes are indexed. */
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

  // Loading from snapshots, once: a key a commit delivered meanwhile is
  // newer than any snapshot that hasn't arrived yet, so it is left alone.
  let loading: Promise<void> | undefined
  const delivered = new Set<string>()
  let loaded = false

  const load = async () => {
    const state = await read.snapshot(Memory, String(familiar), context)
    if (!delivered.has('memory')) {
      memory.setMemory(state ?? null)
    }
    for (const subject of state?.subjects ?? []) {
      const page = await read.snapshot(
        Pages,
        keyOf(familiar, subject.id),
        context,
      )
      if (!delivered.has(`page:${subject.id}`)) {
        memory.setPage(subject.id, page ?? null)
      }
    }
    for (const month of state?.months ?? []) {
      const journal = await read.snapshot(
        Journal,
        keyOf(familiar, month),
        context,
      )
      if (!delivered.has(`journal:${month}`)) {
        memory.setMonth(month, journal ?? null)
      }
    }
    loaded = true
    delivered.clear()
  }

  return Object.assign(memory, {
    /** Loads pages and journal after a restart. Call it outside a commit. */
    ready: () => {
      loading ??= load()
      return loading
    },

    /** Applies a commit's change to one of this Familiar's documents. */
    apply(kind: string, own: string | undefined, value: unknown) {
      const key =
        kind === Memory.definition.kind
          ? 'memory'
          : `${kind === Pages.definition.kind ? 'page' : 'journal'}:${own}`
      if (!loaded) {
        delivered.add(key)
      }
      if (kind === Memory.definition.kind) {
        memory.setMemory(value as MemoryState | null)
      } else if (kind === Pages.definition.kind) {
        memory.setPage(own!, value as PageState | null)
      } else {
        memory.setMonth(own!, value as JournalState | null)
      }
    },

    /** Brings exchanges up to date with the transcript, in a commit's reads. */
    catchUp: (tx: Tx) => reader.read(tx, memory.addExchange),

    /** The first entry the model sees verbatim, as of the last catch-up. */
    viewStart: () => reader.viewStart,
  })
}

/**
 * Each open Familiar's view, made on first use, following `harness`'s
 * commits from now on. `read` loads them after a restart.
 */
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
