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
 * `before`, newest first. With `after`, reads the bounded gap oldest first.
 */
export async function historyOf(
  conversation: Conversation,
  before: EntryId,
  limit: number,
  after?: EntryId,
): Promise<HistoryPage> {
  const page = await conversation.entries(
    {
      maxEntryId: (before - 1) as EntryId,
      ...(after !== undefined && { minEntryId: (after + 1) as EntryId }),
      order: after === undefined ? 'descending' : 'ascending',
    },
    limit,
    undefined,
    BACKGROUND_CONTEXT,
  )
  return { entries: [...page.items], more: page.next !== undefined }
}
