import type { Cursor, EntryQuery, Tx } from '@earendil-works/pi-durable'

/** A conversation's entries in a transaction, a page at a time, so a long transcript never sits in memory whole. */
export async function* entriesOf(tx: Tx, query: EntryQuery) {
  let cursor: Cursor | undefined
  do {
    const page = await tx.scanEntries(query, 200, cursor)
    yield* page.items
    cursor = page.next
  } while (cursor)
}
