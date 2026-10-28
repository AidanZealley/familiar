import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import { localMinute } from '../time/index.ts'
import type { Episode, EpisodesState, Span } from './episodes.ts'
import {
  entryOf,
  exchangeId,
  type Exchange,
  type ExchangeIndex,
} from './exchanges.ts'
import type { Fact, FactsState } from './facts.ts'
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

/**
 * Every version connected to a fact through replacements, in either
 * direction, oldest first: what it replaced, what replaced it, and what
 * else a merge folded in along the way.
 */
function history(facts: FactsState, fact: Fact) {
  const byId = new Map(facts.facts.map((other) => [other.id, other]))
  const seen = new Map([[fact.id, fact]])
  const queue = [fact]
  for (let next = queue.pop(); next; next = queue.pop()) {
    const linked = [
      ...(next.replaces ?? []).flatMap((id) => byId.get(id) ?? []),
      ...facts.facts.filter((other) => other.replaces?.includes(next!.id)),
    ]
    for (const other of linked) {
      if (!seen.has(other.id)) {
        seen.set(other.id, other)
        queue.push(other)
      }
    }
  }
  const number = (fact: Fact) => Number(fact.id.slice(1))
  return [...seen.values()].sort(
    (a, b) => a.since.localeCompare(b.since) || number(a) - number(b),
  )
}

/**
 * As many of `items` as fit in `tokens`, then a note naming the IDs of the
 * rest, and the tokens left.
 */
function upTo(
  items: { id: string; text: string }[],
  tokens: number,
  rest: (ids: string[]) => string,
) {
  const lines: string[] = []
  let left = tokens
  for (const [index, item] of items.entries()) {
    const size = estimateTextTokens(item.text)
    if (size > left) {
      lines.push(rest(items.slice(index).map(({ id }) => id)))
      break
    }
    lines.push(item.text)
    left -= size
  }
  return { lines, left }
}

/** The fact, how it changed, and the messages it came from, all within the budget. */
function readFact(facts: FactsState, exchanges: ExchangeIndex, fact: Fact) {
  const head = describe(facts, { fact })
  const parts = [head]
  let left = READ_TOKENS - estimateTextTokens(head)
  const versions = history(facts, fact)
  if (versions.length > 1) {
    // Half the room at most, so the messages behind it still show.
    const changed = upTo(
      versions.map((version) => ({
        id: version.id,
        text: describe(facts, { fact: version }),
      })),
      left / 2,
      (ids) => `Not shown: ${ids.join(', ')}.`,
    )
    parts.push(`How it changed, oldest first:\n${changed.lines.join('\n')}`)
    left -= left / 2 - changed.left
  }
  const sources = fact.sources.flatMap(
    (entry) => exchanges.around(exchangeId(entry))?.exchange ?? [],
  )
  if (!sources.length) {
    parts.push('It cites no messages: it was written by hand.')
  } else {
    const shown = upTo(
      sources.map((source) => ({
        id: source.id,
        // Each gets an equal share, so one long message can't hide the rest.
        text: showExchange(source, left / sources.length - 20),
      })),
      left,
      (ids) => `Not shown: ${ids.join(', ')}.`,
    )
    parts.push(`From:\n${shown.lines.join('\n\n')}`)
  }
  return parts.join('\n\n')
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
          // Overlapping, as rollups are built: a day across a month's end
          // went into both months.
          other.start <= episode.end &&
          other.end >= episode.start,
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
          ...upTo(
            children,
            READ_TOKENS - estimateTextTokens(head),
            ([id]) => `More from ${id} onwards.`,
          ).lines,
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
      READ_TOKENS - estimateTextTokens(head),
      ([id]) => `Left out from ${id} onwards: read_memory ${id} to read on.`,
    ).lines,
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
