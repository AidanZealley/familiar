import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import MiniSearch from 'minisearch'
import {
  dateFit,
  datesIn,
  daysOf,
  type DateRange,
  type Episode,
  type EpisodesState,
  type Span,
} from './episodes.ts'
import { localDay, localMinute, parseDay } from '../time/index.ts'
import type { Exchange, ExchangeIndex } from './exchanges.ts'
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
   * Added to an episode's or exchange's relevance when the message names its
   * dates, scaled by how closely they fit. About a strong word match, so
   * "what was going on in March?" finds March even when its summary never
   * says "March".
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
 * per reply: about 25 ms for a year of memory, small beside the model's
 * reply. Exchanges are far more numerous, so they have their own lasting
 * index (exchanges.ts) and are ranked in a group of their own.
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

type Ranked = { item: Recalled; score: number }

/**
 * Facts outside core and the given episodes that match `query`, best first,
 * and the current core facts it matched, which the model already sees.
 */
function rank(
  memory: FactsState,
  episodes: readonly Episode[],
  query: string,
  now: number,
) {
  const facts = new Map(memory.facts.map((fact) => [fact.id, fact]))
  const relevance = new Map(
    buildIndex(memory.facts, episodes)
      .search(query)
      .map(({ id, score }) => [id, score]),
  )
  const ranges = datesIn(query, localDay(now))
  const core: string[] = []
  const ranked: Ranked[] = []
  for (const [id, score] of relevance) {
    const fact = facts.get(id)
    if (!fact) {
      continue
    }
    if (fact.core && !isPast(fact)) {
      core.push(id)
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
  for (const episode of episodes) {
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
  return { ranked: ranked.sort((a, b) => b.score - a.score), core }
}

/** Below this many tokens left, an episode is skipped rather than shortened. */
const MIN_EXCERPT_TOKENS = 60

/**
 * Lines that fit in `tokens`, in order, at most `limit`. An episode too long
 * for what is left is shortened to fit rather than dropped; a fact or an
 * exchange is never cut further, since half a fact can say something else.
 */
function within<T extends { line: string; shorten: boolean }>(
  items: T[],
  limit: number,
  tokens: number,
) {
  const kept: T[] = []
  let left = tokens
  for (const item of items) {
    if (kept.length === limit) {
      break
    }
    const size = estimateTextTokens(item.line)
    if (size <= left) {
      kept.push(item)
      left -= size
    } else if (item.shorten && left >= MIN_EXCERPT_TOKENS) {
      const length = Math.floor((item.line.length * left) / size) - 1
      kept.push({ ...item, line: `${item.line.slice(0, length)}…` })
      left = 0
    }
  }
  return { kept, left }
}

const SPANS: Span[] = ['day', 'week', 'month']

/**
 * The episodes automatic recall considers: those no rollup covers yet (a
 * day until its week or month is rolled up, a week until its months are,
 * every month), and any of every span on the days the message names. So its
 * pool grows by a dozen months a year, and older periods surface as their
 * gist.
 */
export function recallCandidates(
  episodes: readonly Episode[],
  ranges: DateRange[],
) {
  const covered = (episode: Episode) =>
    daysOf(episode).every((day) =>
      episodes.some(
        (other) =>
          SPANS.indexOf(other.span) > SPANS.indexOf(episode.span) &&
          other.start <= day &&
          other.end >= day,
      ),
    )
  return episodes.filter(
    (episode) =>
      !covered(episode) || ranges.some((range) => dateFit(episode, range) > 0),
  )
}

export type Search = {
  found: Found[]
  /**
   * Facts the message was about: those found, and core facts it matched,
   * which aren't shown because the model already sees them. Recording these
   * as used keeps relevant core facts from looking stale.
   */
  used: string[]
}

/**
 * Automatic recall: facts outside core and candidate episodes that match
 * `query`, best first, within the limit and token budget.
 */
export function searchMemory(
  memory: FactsState,
  episodes: EpisodesState | undefined,
  query: string,
  now: number,
  { limit = RECALL_LIMIT, tokens = RECALL_TOKENS } = {},
): Search {
  const candidates = recallCandidates(
    episodes?.episodes ?? [],
    datesIn(query, localDay(now)),
  )
  const { ranked, core } = rank(memory, candidates, query, now)
  const { kept } = within(
    ranked.map(({ item }) => ({
      item,
      line: describe(memory, item),
      shorten: 'episode' in item,
    })),
    limit,
    tokens,
  )
  return {
    found: kept.map(({ item, line }) => ({ item, line })),
    used: [
      ...core,
      ...kept.flatMap(({ item }) => ('fact' in item ? [item.fact.id] : [])),
    ],
  }
}

/**
 * Automatic recall's share for exchanges compacted out of the model's view
 * that upkeep hasn't filed yet. They're taken first, so long-term memory
 * can't crowd them out; what they don't use goes back to facts and episodes.
 */
export const UNFILED = { limit: 2, tokens: 250 }

/** Unfiled exchanges as automatic recall shows them, and the tokens they use. */
function describeUnfiled(exchanges: readonly Exchange[], query: string) {
  const { kept, left } = within(
    exchanges.map((exchange) => ({
      line: `${exchange.id} (${localMinute(exchange.at)}): ${excerpt(exchange.text, query)}`,
      shorten: false,
    })),
    UNFILED.limit,
    UNFILED.tokens,
  )
  return {
    lines: kept.map(({ line }) => line),
    tokens: UNFILED.tokens - left,
  }
}

export type RecallNote = {
  /** Facts the message was about, to record as recalled. */
  facts: string[]
  /** What the model is shown, or null when nothing matched. */
  note: string | null
}

/**
 * Automatic recall's note for the latest message: unfiled exchanges within
 * their share, then facts and episodes in what is left.
 */
export function recallNote(
  memory: FactsState,
  episodes: EpisodesState | undefined,
  unfiled: readonly Exchange[],
  query: string,
  now: number,
): RecallNote {
  const recent = describeUnfiled(unfiled, query)
  const { found, used } = searchMemory(memory, episodes, query, now, {
    tokens: RECALL_TOKENS - recent.tokens,
  })
  const lines = [
    ...found.map(({ line }) => line),
    ...(recent.lines.length
      ? ['Earlier conversation, not yet reviewed:', ...recent.lines]
      : []),
  ]
  return {
    facts: used,
    note: lines.length
      ? `Recalled from memory for the latest message; use it only if relevant:\n${lines.join('\n')}`
      : null,
  }
}

/** What the `recall` tool shows of each kind, within RECALL_TOOL_TOKENS together. */
export const RECALL_TOOL = { facts: 8, episodes: 4, exchanges: 6 }
export const RECALL_TOOL_TOKENS = 3_000

/** About this many characters of an exchange are shown around its best match. */
const EXCERPT = 300

/**
 * Around the first word of `query` that `text` contains, so a long exchange
 * shows the part that matched.
 */
export function excerpt(text: string, query: string, length = EXCERPT) {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= length) {
    return flat
  }
  const lower = flat.toLowerCase()
  const at = Math.min(
    ...query
      .split(/[^\p{L}\p{N}]+/u)
      .map((word) => TERMS.processTerm(word))
      .flatMap((term) => (term ? [lower.indexOf(term)] : []))
      .filter((index) => index !== -1),
    flat.length,
  )
  const start = at === flat.length ? 0 : Math.max(0, at - length / 3)
  const end = Math.min(flat.length, start + length)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}

/**
 * The `recall` tool: facts (past ones included), episodes of every span and
 * exchanges matching `query`, each group ranked on its own so scores never
 * need comparing across kinds. Facts list current ones first.
 */
export function recallAll(
  memory: FactsState,
  episodes: EpisodesState,
  exchanges: ExchangeIndex,
  query: string,
  now: number,
) {
  const { ranked, core } = rank(memory, episodes.episodes, query, now)
  const facts = ranked.flatMap(({ item }) => ('fact' in item ? [item] : []))
  const found = within(
    [
      ...facts.filter(({ fact }) => !isPast(fact)),
      ...facts.filter(({ fact }) => isPast(fact)),
    ].map((item) => ({ item, line: describe(memory, item), shorten: false })),
    RECALL_TOOL.facts,
    RECALL_TOOL_TOKENS,
  )
  const dated = within(
    ranked
      .filter(({ item }) => 'episode' in item)
      .map(({ item }) => ({
        item,
        line: describe(memory, item),
        shorten: true,
      })),
    RECALL_TOOL.episodes,
    found.left,
  )
  const said = within(
    exchanges
      .search(query, now, {
        limit: RECALL_TOOL.exchanges,
        ranges: datesIn(query, localDay(now)),
      })
      .map((exchange) => ({
        item: exchange,
        line: `${exchange.id} (${localDay(exchange.at)}): ${excerpt(exchange.text, query)}`,
        shorten: false,
      })),
    RECALL_TOOL.exchanges,
    dated.left,
  )
  const group = (title: string, lines: { line: string }[]) =>
    lines.length ? [`${title}:`, ...lines.map(({ line }) => line)] : []
  const lines = [
    ...group('Facts', found.kept),
    ...group('Episodes', dated.kept),
    ...group('Exchanges', said.kept),
  ]
  return {
    text: lines.length ? lines.join('\n') : 'Nothing found.',
    used: [...core, ...found.kept.map(({ item }) => item.fact.id)],
  }
}

/**
 * An item as recall shows it, with its dates: a fact with when it was true
 * and what replaced it, so past facts can't pass for current ones; an
 * episode with the days it covers.
 */
export function describe(memory: FactsState, item: Recalled) {
  if ('episode' in item) {
    return describeEpisode(item.episode)
  }
  const { fact } = item
  return `${fact.id} (${factDays(memory, fact)}): ${fact.text}`
}

/** An episode with the days it covers. */
export const describeEpisode = ({ id, span, start, end, text }: Episode) =>
  `${id} (${span} of ${start === end ? start : `${start} to ${end}`}): ${text}`
