import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import MiniSearch from 'minisearch'
import {
  dateFit,
  datesIn,
  type Episode,
  type EpisodesState,
} from './episodes.ts'
import { localDay, parseDay } from '../time/index.ts'
import { factDays, isPast, type Fact, type FactsState } from './facts.ts'

/**
 * How recall ranks a match: relevance × importance × recency × past. Text
 * relevance is BM25 from MiniSearch; an embedding similarity could replace or
 * join it without changing the rest.
 */
export const RANKING = {
  /** 1 counts 0.6, 5 counts 1: a minor fact that matches well still beats an important one that barely does. */
  importance: (importance: number) => 0.5 + importance / 10,
  /**
   * Halves each year since it was true, never below a quarter: a current
   * fact is true now, a past one until its `until`, an episode when written.
   */
  recency: (ageMs: number) => Math.max(0.25, 0.5 ** (ageMs / YEAR)),
  /** Past facts rank below current ones that match as well, but still answer "what was it before?". */
  past: 0.6,
  /** Episodes count like an ordinary fact (importance 3). */
  episode: 0.8,
  /**
   * Added to an episode's relevance when the message names its dates, scaled
   * by how closely they fit. About a strong word match, so "what was going
   * on in March?" finds March even when its summary never says "March".
   */
  dated: 10,
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

/**
 * How every memory index splits and matches words, so facts, episodes and
 * exchanges are searched alike.
 */
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

/**
 * One index over facts and episodes, so their relevance scores come from the
 * same word statistics and can be compared. Built per search, which runs once
 * per reply: about 25 ms for a year of memory, small beside the model's reply,
 * and caching it misses anyway, since each reply marks the facts it recalled.
 */
function buildIndex(facts: readonly Fact[], episodes: readonly Episode[]) {
  const index = new MiniSearch<{ id: string; text: string }>({
    fields: ['text'],
    ...TERMS,
  })

  index.addAll([...facts, ...episodes].map(({ id, text }) => ({ id, text })))
  return index
}

/** A fact or an episode. */
export type Recalled = { fact: Fact } | { episode: Episode }

/** A recalled item and how it is shown, an episode shortened if it had to be to fit. */
export type Found = { item: Recalled; line: string }

export type Search = {
  found: Found[]
  /**
   * Facts the message was about: those found, and core facts it matched,
   * which aren't shown because the model already sees them. Recording these
   * as used keeps relevant core facts from looking stale.
   */
  used: string[]
}

/** Below this many tokens left, an episode is skipped rather than shortened. */
const MIN_EXCERPT_TOKENS = 60

/**
 * Facts outside core and episodes that match `query`, best first, within the
 * limit and token budget. Current core facts are left out: the model already
 * sees them. An episode too long for what is left is shortened to fit rather
 * than dropped; a fact is never cut, since half a fact can say something else.
 */
export function searchMemory(
  memory: FactsState,
  episodes: EpisodesState | undefined,
  query: string,
  now: number,
  { limit = RECALL_LIMIT, tokens = RECALL_TOKENS } = {},
): Search {
  const facts = new Map(memory.facts.map((fact) => [fact.id, fact]))
  const allEpisodes = episodes?.episodes ?? []
  const relevance = new Map(
    buildIndex(memory.facts, allEpisodes)
      .search(query)
      .map(({ id, score }) => [id, score]),
  )
  const ranges = datesIn(query, localDay(now))
  const used: string[] = []
  const ranked: { item: Recalled; score: number }[] = []
  for (const [id, score] of relevance) {
    const fact = facts.get(id)
    if (!fact) {
      continue
    }
    if (fact.core && !isPast(fact)) {
      used.push(id)
      continue
    }
    // World time, not when it was saved: a fact filed late isn't fresher.
    const age = fact.until ? now - parseDay(fact.until).getTime() : 0
    ranked.push({
      item: { fact },
      score:
        score *
        RANKING.importance(fact.importance) *
        RANKING.recency(age) *
        (isPast(fact) ? RANKING.past : 1),
    })
  }
  for (const episode of allEpisodes) {
    const fit = Math.max(0, ...ranges.map((range) => dateFit(episode, range)))
    const score =
      (relevance.get(episode.id) ?? 0) + RANKING.dated * Math.sqrt(fit)
    if (score > 0) {
      ranked.push({
        item: { episode },
        score: score * RANKING.episode * RANKING.recency(now - episode.at),
      })
    }
  }
  ranked.sort((a, b) => b.score - a.score)

  const found: Found[] = []
  let left = tokens
  for (const { item } of ranked) {
    if (found.length === limit) {
      break
    }
    const line = describe(memory, item)
    const size = estimateTextTokens(line)
    if (size <= left) {
      found.push({ item, line })
      left -= size
    } else if ('episode' in item && left >= MIN_EXCERPT_TOKENS) {
      const kept = Math.floor((line.length * left) / size) - 1
      found.push({ item, line: `${line.slice(0, kept)}…` })
      left = 0
    }
  }
  for (const { item } of found) {
    if ('fact' in item) {
      used.push(item.fact.id)
    }
  }
  return { found, used }
}

/**
 * An item as recall shows it, with its dates: a fact with when it was true
 * and what replaced it, so past facts can't pass for current ones; an
 * episode with the days it covers.
 */
export function describe(memory: FactsState, item: Recalled) {
  if ('episode' in item) {
    const { id, span, start, end, text } = item.episode
    return `${id} (${span} of ${start === end ? start : `${start} to ${end}`}): ${text}`
  }
  const { fact } = item
  return `${fact.id} (${factDays(memory, fact)}): ${fact.text}`
}
