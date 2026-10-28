import MiniSearch from 'minisearch'
import { localDay } from '../time/index.ts'
import { dateFit, type DateRange } from './episodes.ts'
import { RANKING, TERMS } from './recall.ts'

/**
 * Exchanges: each person message with the replies after it, the smallest
 * piece of the transcript worth finding. They are never stored. The index is
 * a view of the transcript, so losing it loses nothing: it is rebuilt.
 */

export type Exchange = {
  /** `x` and the person message's entry ID. */
  id: string
  /** When the person sent it, in ms since the epoch. */
  at: number
  /** The person's text, then the replies. */
  text: string
}

export type ExchangeSearchOptions = {
  limit?: number
  /** Days the query names; exchanges on them rank higher, as episodes do. */
  ranges?: DateRange[]
}

export type ExchangeIndex = {
  /** Adds an exchange whose text is final. The index only ever appends. */
  add(exchange: Exchange): void
  /** Matching exchanges, best first. */
  search(
    query: string,
    now: number,
    options?: ExchangeSearchOptions,
  ): Exchange[]
  /** How many exchanges are indexed. */
  readonly size: number
}

/** An empty in-memory index of exchanges, searched with recall's term processing. */
export function createExchangeIndex(): ExchangeIndex {
  const index = new MiniSearch<{ id: string; text: string }>({
    fields: ['text'],
    ...TERMS,
  })
  // In the order added, which is the transcript's, with each one's day.
  const exchanges: { exchange: Exchange; day: string }[] = []
  const byId = new Map<string, Exchange>()

  return {
    add(exchange) {
      index.add({ id: exchange.id, text: exchange.text })
      exchanges.push({ exchange, day: localDay(exchange.at) })
      byId.set(exchange.id, exchange)
    },

    search(query, now, { limit = 6, ranges = [] } = {}) {
      const scores = new Map(
        index.search(query).map(({ id, score }) => [id as string, score]),
      )
      if (ranges.length) {
        for (const { exchange, day } of exchanges) {
          const fit = Math.max(
            ...ranges.map((range) => dateFit({ start: day, end: day }, range)),
          )
          if (fit > 0) {
            scores.set(
              exchange.id,
              (scores.get(exchange.id) ?? 0) + RANKING.dated * Math.sqrt(fit),
            )
          }
        }
      }

      return [...scores]
        .map(([id, score]) => {
          const exchange = byId.get(id)!
          return {
            exchange,
            score: score * RANKING.recency(now - exchange.at),
          }
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ exchange }) => exchange)
    },

    get size() {
      return exchanges.length
    },
  }
}
