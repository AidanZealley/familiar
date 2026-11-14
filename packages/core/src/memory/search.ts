import MiniSearch from 'minisearch'
import { overlaps, type DateRange } from './dates.ts'

/**
 * One word index over exchanges (`x…`) and notes (`n…`). An exchange also
 * carries its journal lines as extra words, a note its subject's name.
 * Everything in it is derived (see view.ts), so it owns nothing.
 */

export type SearchDoc = {
  id: string
  text: string
  /** Words that also find it: an exchange's journal lines, a note's subject. */
  keys: string
  /** The days it covers: an exchange's own day and its lines' days; a note's since onwards. */
  days: DateRange[]
}

export type SearchFilter = {
  kind?: 'exchange' | 'note'
  /** Only what covers a day in one of these. */
  ranges?: readonly DateRange[]
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
    // Fragments such as the "s" of "what's" match nothing meaningful, but
    // short numbers, like the 66 of "66 cm", still count.
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

export function createSearchIndex() {
  const index = new MiniSearch<SearchDoc>({
    fields: ['text', 'keys'],
    ...TERMS,
    searchOptions: { ...TERMS.searchOptions, boost: { keys: 1.5 } },
  })
  const days = new Map<string, DateRange[]>()

  const passes = (id: string, filter: SearchFilter) =>
    (!filter.kind || (filter.kind === 'exchange') === id.startsWith('x')) &&
    (!filter.ranges?.length ||
      days
        .get(id)!
        .some((span) => filter.ranges!.some((range) => overlaps(span, range))))

  return {
    /** Adds a document, or replaces the one with its ID. */
    put(doc: SearchDoc) {
      if (days.has(doc.id)) {
        index.replace(doc)
      } else {
        index.add(doc)
      }
      days.set(doc.id, doc.days)
    },
    remove(id: string) {
      if (days.delete(id)) {
        index.discard(id)
      }
    },
    /**
     * Every match for `query` that passes `filter`, by relevance. A query
     * with no usable words matches everything that passes, at score 0.
     */
    search(query: string, filter: SearchFilter = {}) {
      if (!hasTerms(query)) {
        return [...days.keys()]
          .filter((id) => passes(id, filter))
          .map((id) => ({ id, score: 0 }))
      }
      return index
        .search(query)
        .filter(({ id }) => passes(id as string, filter))
        .map(({ id, score }) => ({ id: id as string, score }))
    },
    get size() {
      return days.size
    },
  }
}
