import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import MiniSearch from 'minisearch'
import {
  calendarLabels,
  localDay,
  type Episode,
  type EpisodesState,
} from './episodes.ts'
import { isPast, type Fact, type MemoryState } from './facts.ts'

/**
 * How recall ranks a match: relevance × importance × recency × past. Text
 * relevance is BM25 from MiniSearch; an embedding similarity could replace or
 * join it without changing the rest.
 */
export const RANKING = {
  /** 1 counts 0.6, 5 counts 1: a minor fact that matches well still beats an important one that barely does. */
  importance: (importance: number) => 0.5 + importance / 10,
  /** Halves each year since the fact was last written or recalled, never below a quarter: old facts are still true. */
  recency: (ageMs: number) => Math.max(0.25, 0.5 ** (ageMs / YEAR)),
  /** Past facts rank below current ones that match as well, but still answer "what was it before?". */
  past: 0.6,
  /** Episodes count like an ordinary fact (importance 3). */
  episode: 0.8,
}

/** At most this many facts are recalled before each request, within about this many tokens. */
export const RECALL_LIMIT = 8
export const RECALL_TOKENS = 1_000

const YEAR = 365 * 24 * 60 * 60 * 1000

// Without these, "I" or "my" would match almost every fact.
const STOP_WORDS = new Set(
  `a about after again all am an and any are as at be been before but by can could did do does doing for from had has have he her here him his how i if in into is it its just me more most my no not now of on once only or other our out over own same she should so some such than that the their them then there these they this to too under until up very was we were what when where which while who why will with would you your`.split(
    ' ',
  ),
)

type Searchable = { id: string; text: string; labels?: string }
const indexes = new WeakMap<
  readonly Fact[],
  WeakMap<readonly Episode[], MiniSearch<Searchable>>
>()

/**
 * One index over facts and episodes, so their relevance scores come from the
 * same word statistics and can be compared. Any change to memory gives new
 * arrays, so a stale index is never used.
 */
function indexOf(facts: readonly Fact[], episodes: readonly Episode[]) {
  let byEpisodes = indexes.get(facts)
  if (!byEpisodes) indexes.set(facts, (byEpisodes = new WeakMap()))
  let index = byEpisodes.get(episodes)
  if (!index) {
    index = new MiniSearch<Searchable>({
      // An episode's labels name its dates and months, so "what was going on
      // in March?" finds it even when its text never says "March".
      fields: ['text', 'labels'],
      processTerm: (term) => {
        const lower = term.toLowerCase()
        // Fragments such as the "s" of "what's" match nothing meaningful,
        // and prefix matching would expand them to every word they start.
        // Short numbers, like the 66 of "66 cm", still count.
        if (STOP_WORDS.has(lower) || (lower.length < 3 && !/^\d+$/.test(lower)))
          return null
        return lower
      },
      searchOptions: {
        prefix: (term) => term.length >= 4,
        fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
      },
    })
    index.addAll(facts.map(({ id, text }) => ({ id, text })))
    index.addAll(
      episodes.map((episode) => ({
        id: episode.id,
        text: episode.text,
        labels: calendarLabels(episode),
      })),
    )
    byEpisodes.set(episodes, index)
  }
  return index
}

/** A fact or an episode. */
export type Recalled = { fact: Fact } | { episode: Episode }

/** A recalled item and how it is shown, shortened if it had to be to fit. */
export type Found = { item: Recalled; line: string }

/** The facts among recalled items, for recording `recalled`. */
export const factIds = (found: Found[]) =>
  found.flatMap(({ item }) => ('fact' in item ? [item.fact.id] : []))

/** Below this many tokens left, an item is skipped rather than shortened. */
const MIN_EXCERPT_TOKENS = 60

/**
 * Facts outside core and episodes that match `query`, best first, within the
 * limit and token budget. Current core facts are left out: the model already
 * sees them. An item too long for what is left is shortened to fit rather
 * than dropped, so a long monthly episode still comes back.
 */
export function searchMemory(
  memory: MemoryState,
  episodes: EpisodesState | undefined,
  query: string,
  now: number,
  { limit = RECALL_LIMIT, tokens = RECALL_TOKENS } = {},
): Found[] {
  const facts = new Map(memory.facts.map((fact) => [fact.id, fact]))
  const allEpisodes = episodes?.episodes ?? []
  const byId = new Map(allEpisodes.map((episode) => [episode.id, episode]))
  const ranked = indexOf(memory.facts, allEpisodes)
    .search(query)
    .flatMap(({ id, score }) => {
      const fact = facts.get(id)
      if (fact) {
        if (fact.core && !isPast(fact)) return []
        const age = now - Math.max(fact.at, fact.recalled ?? 0)
        return [
          {
            item: { fact } as Recalled,
            score:
              score *
              RANKING.importance(fact.importance) *
              RANKING.recency(age) *
              (isPast(fact) ? RANKING.past : 1),
          },
        ]
      }
      const episode = byId.get(id)
      if (!episode) return []
      return [
        {
          item: { episode } as Recalled,
          score: score * RANKING.episode * RANKING.recency(now - episode.at),
        },
      ]
    })
    .sort((a, b) => b.score - a.score)

  const found: Found[] = []
  let left = tokens
  for (const { item } of ranked) {
    if (found.length === limit || left < MIN_EXCERPT_TOKENS) break
    const line = describe(memory, item)
    const size = estimateTextTokens(line)
    if (size <= left) {
      found.push({ item, line })
      left -= size
    } else {
      const kept = Math.floor((line.length * left) / size) - 1
      found.push({ item, line: `${line.slice(0, kept)}…` })
      left = 0
    }
  }
  return found
}

/**
 * An item as recall shows it, with its dates: a fact with when it was true
 * and what replaced it, so past facts can't pass for current ones; an
 * episode with the days it covers.
 */
export function describe(memory: MemoryState, item: Recalled) {
  if ('episode' in item) {
    const { id, span, start, end, text } = item.episode
    return `${id} (${span} of ${start === end ? start : `${start} to ${end}`}): ${text}`
  }
  const { fact } = item
  const replacedBy = memory.facts.find((other) =>
    other.replaces?.includes(fact.id),
  )
  const when = isPast(fact)
    ? `${localDay(fact.created)} to ${localDay(fact.until!)}, no longer current${replacedBy ? `; replaced by ${replacedBy.id}` : ''}`
    : `since ${localDay(fact.created)}`
  return `${fact.id} (${when}): ${fact.text}`
}
