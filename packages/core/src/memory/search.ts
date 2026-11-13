import type { EntryId } from '@earendil-works/pi-durable'
import MiniSearch from 'minisearch'
import { overlaps, type DateRange } from './dates.ts'

/**
 * Memory's search port: one index over exchanges and notes, where an
 * exchange also carries its journal lines as extra words. Everything it
 * holds is derived (see view.ts), so it owns nothing that can't be rebuilt.
 * The in-memory MiniSearch below is the default; an implementation in the
 * SQLite database the hosts share (FTS5) can replace it behind this type,
 * resuming its exchanges from `through` instead of the transcript's start.
 */

/** What is indexed: an exchange (`x…`) or a note (`n…`). */
export type SearchDoc = {
  id: string
  text: string
  /** Words that also find it: an exchange's journal lines. */
  keys: string
  /** The days it covers: an exchange's own day and its lines' days; a note's since to until. */
  days: DateRange[]
  /** Subjects it is on or names. */
  subjects: string[]
}

export type SearchFilter = {
  kind?: 'exchange' | 'note'
  /** Only what covers a day in one of these. */
  ranges?: readonly DateRange[]
  /** Only what is on or names one of these subjects. */
  about?: readonly string[]
}

export type Match = { id: string; score: number }

export type SearchIndex = {
  /**
   * The newest transcript entry whose exchange is indexed: where reading the
   * transcript resumes for an index that outlives the process.
   */
  readonly through: EntryId | null
  /** Adds a document, or replaces the one with its ID. */
  put(doc: SearchDoc): void
  /** Records that exchanges are indexed through `entry`. */
  mark(entry: EntryId): void
  remove(id: string): void
  /**
   * Every match for `query` that passes `filter`, by relevance, unordered.
   * An empty query matches everything that passes the filter, at score 0.
   */
  search(query: string, filter?: SearchFilter): Match[]
  readonly size: number
}

// Without these, "I" or "my" would match almost everything.
const STOP_WORDS = new Set(
  `a about after again all am an and any are as at be been before but by can could did do does doing for from had has have he her here him his how i if in into is it its just me more most my no not now of on once only or other our out over own same she should so some such than that the their them then there these they this to too under until up very was we were what when where which while who why will with would you your`.split(
    ' ',
  ),
)

/** How every memory search splits and matches words. */
export const TERMS = {
  processTerm: (term: string) => {
    const lower = term.toLowerCase()

    // Fragments such as the "s" of "what's" match nothing meaningful, and
    // prefix matching would expand them to every word they start. Short
    // numbers, like the 66 of "66 cm", still count.
    if (STOP_WORDS.has(lower) || (lower.length < 3 && !/^\d+$/.test(lower))) {
      return null
    }

    return lower
  },
  searchOptions: {
    prefix: (term: string) => term.length >= 4,
    fuzzy: (term: string) => (term.length >= 5 ? 0.2 : false),
  },
}

/** Whether `query` has any word search can use. */
export const hasTerms = (query: string) =>
  query
    .split(/[^\p{L}\p{N}]+/u)
    .some((word) => word && TERMS.processTerm(word) !== null)

type Meta = Pick<SearchDoc, 'days' | 'subjects'>

const passes = (id: string, meta: Meta, filter: SearchFilter) =>
  (!filter.kind || (filter.kind === 'exchange') === id.startsWith('x')) &&
  (!filter.ranges?.length ||
    meta.days.some((days) =>
      filter.ranges!.some((range) => overlaps(days, range)),
    )) &&
  (!filter.about?.length ||
    meta.subjects.some((subject) => filter.about!.includes(subject)))

/** The default index: MiniSearch in memory, rebuilt after each restart. */
export function createSearchIndex(): SearchIndex {
  const index = new MiniSearch<SearchDoc>({
    fields: ['text', 'keys'],
    ...TERMS,
    searchOptions: { ...TERMS.searchOptions, boost: { keys: 1.5 } },
  })
  const metas = new Map<string, Meta>()
  let through: EntryId | null = null

  return {
    get through() {
      return through
    },
    put(doc) {
      if (metas.has(doc.id)) {
        index.replace(doc)
      } else {
        index.add(doc)
      }
      metas.set(doc.id, { days: doc.days, subjects: doc.subjects })
    },
    mark(entry) {
      through = entry
    },
    remove(id) {
      if (metas.delete(id)) {
        index.discard(id)
      }
    },
    search(query, filter = {}) {
      if (!hasTerms(query)) {
        return [...metas]
          .filter(([id, meta]) => passes(id, meta, filter))
          .map(([id]) => ({ id, score: 0 }))
      }
      return index
        .search(query)
        .flatMap(({ id, score }) =>
          passes(id, metas.get(id)!, filter)
            ? [{ id: id as string, score }]
            : [],
        )
    },
    get size() {
      return metas.size
    },
  }
}
