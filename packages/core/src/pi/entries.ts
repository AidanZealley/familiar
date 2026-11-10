import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type {
  Conversation,
  Cursor,
  EntryId,
  EntryQuery,
  EntryRecord,
  Tx,
} from '@earendil-works/pi-durable'

/**
 * Paging through a conversation's entries, which Pi hands out a page at a
 * time. Knows nothing of Familiar.
 */

export type HistoryPage = { entries: EntryRecord[]; more: boolean }

/** A conversation's entries in a transaction, a page at a time, so a long transcript never sits in memory whole. */
export async function* entriesOf(tx: Tx, query: EntryQuery) {
  let cursor: Cursor | undefined
  do {
    const page = await tx.scanEntries(query, 200, cursor)
    yield* page.items
    cursor = page.next
  } while (cursor)
}

/**
 * Up to `limit` committed entries of `conversation` older than entry
 * `before`, newest first, including those compaction or a view marker took
 * out of the view.
 */
export async function historyOf(
  conversation: Conversation,
  before: EntryId,
  limit: number,
): Promise<HistoryPage> {
  // Entry IDs are ascending integers, and the bound is inclusive.
  const query = { maxEntryId: (before - 1) as EntryId }
  const entries: EntryRecord[] = []

  let cursor: Cursor | undefined

  // One past the limit tells whether more exist.
  do {
    const page = await conversation.entries(
      query,
      limit + 1 - entries.length,
      cursor,
      BACKGROUND_CONTEXT,
    )
    entries.push(...page.items)
    cursor = page.next
  } while (cursor && entries.length <= limit)

  return {
    entries: entries.slice(0, limit),
    more: entries.length > limit,
  }
}
