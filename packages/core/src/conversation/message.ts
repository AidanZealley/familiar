import type { Message } from '@earendil-works/pi-ai'
import type {
  Cursor,
  EntryQuery,
  EntryRecord,
  Tx,
} from '@earendil-works/pi-durable'

/** The entry kind people's messages are stored as. */
export const MESSAGE_KIND = 'familiar.message'

export type MessageData = { author: string; text: string }

/** The text of a model message, without its images, thinking or tool calls. */
export const textOf = (message: Message) => {
  if (typeof message.content === 'string') {
    return message.content
  }

  // flatMap rather than filter, so TypeScript knows each part is text.
  return message.content
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
}

export type Said =
  | { role: 'person'; author: string; text: string; at: number }
  | { role: 'assistant'; text: string; at: number }

/** Who said what, for the entries people and the assistant wrote. */
export function saidBy(entry: EntryRecord): Said | undefined {
  const message = entry.model?.[0]

  if (!message) {
    return undefined
  }

  // pi.user is input submitted without an author, such as by a host directly.
  if (entry.kind === MESSAGE_KIND || entry.kind === 'pi.user') {
    const data = entry.data as Partial<MessageData> | undefined

    return {
      role: 'person',
      author: data?.author || 'user',
      text: textOf(message),
      at: message.timestamp,
    }
  }

  if (entry.kind === 'pi.assistant') {
    const text = textOf(message)

    // A reply that only called tools has nothing to show.
    return text ? { role: 'assistant', text, at: message.timestamp } : undefined
  }

  return undefined
}

/** A conversation's entries in a transaction, a page at a time, so a long transcript never sits in memory whole. */
export async function* entriesOf(tx: Tx, query: EntryQuery) {
  let cursor: Cursor | undefined
  do {
    const page = await tx.scanEntries(query, 200, cursor)
    yield* page.items
    cursor = page.next
  } while (cursor)
}
