import {
  ROOT_CONVERSATION_ID,
  type EntryId,
  type Tx,
} from '@earendil-works/pi-durable'
import MiniSearch from 'minisearch'
import { entriesOf, saidBy } from '../conversation/message.ts'
import { localDay } from '../time/index.ts'
import { dateFit, type DateRange } from './episodes.ts'
import { RANKING, TERMS } from './recall.ts'

/**
 * Exchanges: each person message with the replies after it, the smallest
 * piece of the transcript worth finding. They are never stored. The index is
 * a view of the transcript, so losing it loses nothing: it is rebuilt.
 */

/** An exchange's ID: `x` and its person message's entry ID. */
export const exchangeId = (entry: EntryId) => `x${entry}`

/** The person message an exchange ID names, or undefined if it isn't one. */
export const entryOf = (id: string) =>
  /^x\d+$/.test(id) ? (Number(id.slice(1)) as EntryId) : undefined

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
  /** An exchange and the ones either side of it, if it is indexed. */
  around(
    id: string,
  ): { before?: Exchange; exchange: Exchange; after?: Exchange } | undefined
  /** Exchanges whose person message is from `from` to `to`, oldest first. */
  between(from: EntryId, to: EntryId): Exchange[]
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
  const positions = new Map<string, number>()

  return {
    add(exchange) {
      index.add({ id: exchange.id, text: exchange.text })
      positions.set(exchange.id, exchanges.length)
      exchanges.push({ exchange, day: localDay(exchange.at) })
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
          const { exchange } = exchanges[positions.get(id)!]
          return {
            exchange,
            score: score * RANKING.recency(now - exchange.at),
          }
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ exchange }) => exchange)
    },

    around(id) {
      const at = positions.get(id)
      return at === undefined
        ? undefined
        : {
            before: exchanges[at - 1]?.exchange,
            exchange: exchanges[at].exchange,
            after: exchanges[at + 1]?.exchange,
          }
    },

    between(from, to) {
      return exchanges.flatMap(({ exchange }) => {
        const entry = entryOf(exchange.id)
        return entry !== undefined && entry >= from && entry <= to
          ? [exchange]
          : []
      })
    },

    get size() {
      return exchanges.length
    },
  }
}

/**
 * The index over the main conversation, kept by memory for as long as
 * Familiar runs. `catchUp` reads the transcript after the last entry it saw
 * and is called at the start of each search, so the index never needs
 * telling about new messages. An exchange is added only once the next
 * person message exists, so every indexed text is final; the newest is
 * still in the model's context anyway. After a restart the first search
 * rebuilds it from the start of the transcript.
 */
export function transcriptExchanges() {
  const index = createExchangeIndex()
  let through: EntryId | undefined
  let open: Exchange | undefined
  let buildMs = 0

  return {
    async catchUp(tx: Tx) {
      const started = performance.now()
      for await (const entry of entriesOf(tx, {
        conversationId: ROOT_CONVERSATION_ID,
        order: 'ascending',
        ...(through !== undefined && {
          minEntryId: (through + 1) as EntryId,
        }),
      })) {
        through = entry.id
        const said = saidBy(entry)
        if (said?.role === 'person') {
          if (open) {
            index.add(open)
          }
          open = { id: exchangeId(entry.id), at: said.at, text: said.text }
        } else if (said && open) {
          open = { ...open, text: `${open.text}\n${said.text}` }
        }
      }
      buildMs += performance.now() - started
      return index
    },

    /** Time spent catching up since Familiar started, which is the index's build time. */
    get buildMs() {
      return buildMs
    },
  }
}

export type TranscriptExchanges = ReturnType<typeof transcriptExchanges>
