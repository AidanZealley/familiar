import {
  CompactionEntry,
  type EntryId,
  type Tx,
} from '@earendil-works/pi-durable'
import MiniSearch from 'minisearch'
import { saidBy, type Author } from '../conversation/message.ts'
import { localDay } from '../time.ts'
import { dateFit, type DateRange } from './episodes.ts'
import { RANKING, TERMS } from './recall.ts'
import type { FamiliarId } from '../workspace/familiars.ts'
import { entriesOf } from '../pi/entries.ts'

/**
 * Exchanges: each person message (or scheduled prompt) with the replies after it, the smallest
 * piece of the transcript worth finding. They are never stored. The index is
 * a view of the transcript, so losing it loses nothing: it is rebuilt.
 */

/**
 * A person's text and, after it, what the Familiar was shown from the room
 * with it, so facts said only there can be found and read in their exchange.
 */
const withContext = ({ text, context }: { text: string; context?: string }) =>
  context
    ? `${text}\n[Shown from the room with it, said by others]\n${context}`
    : text

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
  /** Author snapshot, or creator when this exchange was scheduled. */
  author?: Author
  /** The person's text, then the replies. */
  text: string
  /** Its newest entry: the last reply, or the person message if none yet. */
  last: EntryId
}

export type ExchangeSearchOptions = {
  limit?: number
  /** Days the query names; exchanges on them rank higher, as episodes do. */
  ranges?: DateRange[]
  /**
   * Only exchanges with entries between these two, exclusive: one a range
   * boundary splits still counts. `after` null means from the start.
   */
  within?: { after: EntryId | null; before: EntryId }
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
/** `timeZone` dates each exchange, for searches that name days. */
export function createExchangeIndex(timeZone: string): ExchangeIndex {
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
      exchanges.push({ exchange, day: localDay(exchange.at, timeZone) })
    },

    search(query, now, { limit = 6, ranges = [], within } = {}) {
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

      // An exchange a boundary splits still counts: it starts before
      // `before` and ends after `after`.
      const inRange = (exchange: Exchange) => {
        if (!within) {
          return true
        }
        const { after, before } = within
        const first = entryOf(exchange.id)
        return (
          first !== undefined &&
          first < before &&
          (after === null || exchange.last > after)
        )
      }

      return [...scores]
        .filter(([id]) => inRange(exchanges[positions.get(id)!].exchange))
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
 * The index over a Familiar's chat, kept by memory for as long as the
 * workspace runs. `catchUp` reads the transcript after the last entry it saw
 * and is called at the start of each search, so the index never needs
 * telling about new messages. An exchange is added only once the next
 * person message exists, so every indexed text is final; the newest is
 * still in the model's context anyway. After a restart the first search
 * rebuilds it from the start of the transcript. It also notes where the
 * model's view begins, from the latest compaction, so searches can find
 * what compaction took out of it.
 */
export function transcriptExchanges(familiar: FamiliarId, timeZone: string) {
  const index = createExchangeIndex(timeZone)
  let through: EntryId | undefined
  let open: Exchange | undefined
  let viewStart: EntryId | undefined

  return {
    async catchUp(tx: Tx) {
      for await (const entry of entriesOf(tx, {
        conversationId: familiar,
        order: 'ascending',
        ...(through !== undefined && {
          minEntryId: (through + 1) as EntryId,
        }),
      })) {
        through = entry.id
        if (CompactionEntry.is(entry)) {
          viewStart = entry.head
        }
        const said = saidBy(entry)
        // A scheduled prompt and its reply are an exchange of their own.
        if (said && said.role !== 'assistant') {
          if (open) {
            index.add(open)
          }
          open = {
            id: exchangeId(entry.id),
            at: said.at,
            author: said.role === 'person' ? said.author : said.creator,
            text: said.role === 'person' ? withContext(said) : said.text,
            last: entry.id,
          }
        } else if (said && open) {
          open = { ...open, text: `${open.text}\n${said.text}`, last: entry.id }
        }
      }
      return index
    },

    /**
     * The first entry the model sees verbatim, as of the last catch-up, or
     * undefined before any compaction.
     */
    get viewStart() {
      return viewStart
    },
  }
}

export type TranscriptExchanges = ReturnType<typeof transcriptExchanges>

/** Each Familiar's index, made on first use. */
export function exchangesByFamiliar(timeZone: string) {
  const indexes = new Map<FamiliarId, TranscriptExchanges>()
  return (familiar: FamiliarId) => {
    let index = indexes.get(familiar)
    if (!index) {
      index = transcriptExchanges(familiar, timeZone)
      indexes.set(familiar, index)
    }
    return index
  }
}

export type ExchangesOf = ReturnType<typeof exchangesByFamiliar>
