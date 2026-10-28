import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import { localMinute } from '../time/index.ts'
import type { Episode, EpisodesState, Span } from './episodes.ts'
import {
  entryOf,
  exchangeId,
  type Exchange,
  type ExchangeIndex,
} from './exchanges.ts'
import { successorOf, type Fact, type FactsState } from './facts.ts'
import { describe, describeEpisode } from './recall.ts'

/**
 * What `read_memory` shows behind an ID: the layer below what recall found,
 * down to the original messages, so a weak summary or a terse fact never
 * makes the detail behind it unreachable.
 */

/** `read_memory` answers within about this many tokens. */
export const READ_TOKENS = 3_000

/** `text` cut to about `tokens`, marked where it was cut. */
function clip(text: string, tokens: number) {
  const size = estimateTextTokens(text)
  if (size <= tokens) {
    return text
  }
  return `${text.slice(0, Math.max(0, Math.floor((text.length * tokens) / size) - 1))}…`
}

const showExchange = ({ id, at, text }: Exchange, tokens: number) =>
  `${id} (${localMinute(at)}):\n${clip(text, tokens)}`

/** The exchange with the one before and after it, the middle one given most room. */
function readExchange(exchanges: ExchangeIndex, id: string) {
  const found = exchanges.around(id)
  if (!found) {
    return `No exchange ${id}. The latest message isn't searchable yet: you can already see it.`
  }
  const { before, exchange, after } = found
  return [
    before && `Before:\n${showExchange(before, READ_TOKENS / 6)}`,
    showExchange(exchange, (READ_TOKENS * 2) / 3),
    after && `After:\n${showExchange(after, READ_TOKENS / 6)}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Every version a fact replaced, oldest first, merges included. */
function earlier(facts: FactsState, fact: Fact): Fact[] {
  return (fact.replaces ?? []).flatMap((id) => {
    const old = facts.facts.find((other) => other.id === id)
    return old ? [...earlier(facts, old), old] : []
  })
}

/** The versions that replaced a fact, in order. */
function later(facts: FactsState, fact: Fact): Fact[] {
  const next = successorOf(facts, fact)
  return next ? [next, ...later(facts, next)] : []
}

/** The fact, how it changed, and the messages it came from. */
function readFact(facts: FactsState, exchanges: ExchangeIndex, fact: Fact) {
  const show = (other: Fact) => describe(facts, { fact: other })
  const before = earlier(facts, fact)
  const after = later(facts, fact)
  const sources = fact.sources.flatMap(
    (entry) => exchanges.around(exchangeId(entry))?.exchange ?? [],
  )
  const parts = [show(fact)]
  if (before.length || after.length) {
    parts.push(
      `How it changed, oldest first:\n${[...before, fact, ...after].map(show).join('\n')}`,
    )
  }
  parts.push(
    sources.length
      ? `From:\n${sources
          .map((source) =>
            showExchange(source, (READ_TOKENS * 0.8) / sources.length),
          )
          .join('\n\n')}`
      : 'It cites no messages: it was written by hand.',
  )
  return parts.join('\n\n')
}

/** As many of `items` as fit in what is left of the budget, then where to continue. */
function upTo(
  items: { id: string; text: string }[],
  used: string,
  next: (id: string) => string,
) {
  const lines: string[] = []
  let left = READ_TOKENS - estimateTextTokens(used)
  for (const item of items) {
    const size = estimateTextTokens(item.text)
    if (size > left) {
      lines.push(next(item.id))
      break
    }
    lines.push(item.text)
    left -= size
  }
  return lines
}

const finer: Record<Span, Span[]> = {
  day: [],
  week: ['day'],
  month: ['week', 'day'],
}

/** The first line of an episode, for a list of them. */
const firstLine = (text: string) => {
  const line = text.split(/(?<=[.!?])\s|\n/)[0]
  return line.length > 160 ? `${line.slice(0, 159)}…` : line
}

/**
 * A day's episode with its exchanges, oldest first; a week's or month's with
 * the episodes it was rolled up from, to read further.
 */
function readEpisode(
  episodes: EpisodesState,
  exchanges: ExchangeIndex,
  episode: Episode,
) {
  const head = describeEpisode(episode)
  if (episode.span !== 'day') {
    const children = episodes.episodes
      .filter(
        (other) =>
          finer[episode.span].includes(other.span) &&
          other.start >= episode.start &&
          other.end <= episode.end,
      )
      .sort(
        (a, b) =>
          a.start.localeCompare(b.start) ||
          finer[episode.span].indexOf(a.span) -
            finer[episode.span].indexOf(b.span),
      )
      .map((child) => ({
        id: child.id,
        text: `${child.id} (${child.span} of ${child.start === child.end ? child.start : `${child.start} to ${child.end}`}): ${firstLine(child.text)}`,
      }))
    return children.length
      ? [
          head,
          'Rolled up from:',
          ...upTo(children, head, (id) => `More from ${id} onwards.`),
        ].join('\n')
      : head
  }
  const said =
    episode.entries &&
    exchanges.between(episode.entries.from, episode.entries.to)
  if (!said?.length) {
    return `${head}\n\nIts messages aren't recorded.`
  }
  return [
    head,
    ...upTo(
      said.map((exchange) => ({
        id: exchange.id,
        text: showExchange(exchange, READ_TOKENS),
      })),
      head,
      (id) => `Left out from ${id} onwards: read_memory ${id} to read on.`,
    ),
  ].join('\n\n')
}

/** What lies behind a fact, an episode or an exchange ID. */
export function readMemory(
  id: string,
  facts: FactsState,
  episodes: EpisodesState,
  exchanges: ExchangeIndex,
) {
  if (entryOf(id) !== undefined) {
    return readExchange(exchanges, id)
  }
  const fact = facts.facts.find((fact) => fact.id === id)
  if (fact) {
    return readFact(facts, exchanges, fact)
  }
  const episode = episodes.episodes.find((episode) => episode.id === id)
  if (episode) {
    return readEpisode(episodes, exchanges, episode)
  }
  return `Nothing has the ID ${id}. Facts start with f, episodes with e and exchanges with x.`
}
