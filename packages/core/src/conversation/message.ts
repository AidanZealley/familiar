import type { Message } from '@earendil-works/pi-ai'
import type {
  Cursor,
  EntryId,
  EntryQuery,
  EntryRecord,
  GenerationCheckpoint,
  ToolTaskInput,
  TaskId,
  Tx,
} from '@earendil-works/pi-durable'

/** The entry kind people's messages are stored as. */
export const MESSAGE_KIND = 'familiar.message'

/** Host-owned identity with a display name captured at send time. */
export type Author = {
  /** Stable host-owned identity, unchanged across devices and renames. */
  id: string
  /** Display name when this message was sent. */
  name: string
}

/** A person's message as stored, without parsing the model's copy. */
export type MessageData = { author: Author; text: string }

/** Historical entries may have only a name. New sends still require an Author. */
export type StoredMessageData = { author: Author | string; text: string }

/** Reject malformed host identities rather than admitting an unattributed message. */
export function authorSnapshot(author: Author): Author {
  if (
    typeof author?.id !== 'string' ||
    !author.id.trim() ||
    typeof author.name !== 'string' ||
    !author.name.trim()
  ) {
    throw new TypeError('An author requires a non-empty id and name.')
  }
  return { id: author.id, name: author.name }
}

/** JSON stays on one line even when a host supplies control characters. */
export const formatAuthor = (author: StoredMessageData['author']) =>
  JSON.stringify(author).replace(
    /[\u007f-\u009f\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )

/**
 * What the model sees for a person's message: a first line naming the author,
 * then their words unchanged. The author is a JSON string, with Unicode line
 * breaks escaped too, so no name can end the line or the quotes early.
 */
export const formatMessage = ({ author, text }: MessageData) =>
  `[Message from ${formatAuthor(author)}]\n${text}`

/**
 * The person's message a generation request answers, read from its entry so
 * the words are exactly as sent. Undefined outside a request, or when the
 * latest input came from no one in the moment, such as a schedule or upkeep.
 */
export async function answeredMessage(tx: Tx, taskId: TaskId) {
  const task = await tx.task(taskId)
  const checkpoint = task?.state.checkpoint as GenerationCheckpoint | undefined

  if (!task || checkpoint?.phase !== 'request') {
    return undefined
  }

  // Where the request's view starts, once a compaction's summary says so.
  let head: EntryId | undefined

  // Newest first, from the last entry the request includes.
  for await (const entry of entriesOf(tx, {
    conversationId: task.conversationId,
    maxEntryId: checkpoint.cutoff,
  })) {
    // A summary is stored after the entries it kept, but the model reads it
    // first, and nothing before those.
    if (entry.head) {
      head ??= entry.head
      continue
    }

    if (head !== undefined && entry.id < head) {
      return undefined
    }

    if (entry.model?.some((message) => message.role === 'user')) {
      return entry.kind === MESSAGE_KIND
        ? (entry.data as StoredMessageData)
        : undefined
    }
  }

  return undefined
}

/** The entry kind a schedule's prompt is submitted as when it falls due. */
export const SCHEDULED_KIND = 'familiar.scheduled'

export type ScheduledData = {
  scheduleId: string
  creator?: Author
  prompt: string
  /** The time it was scheduled for, in ms since the epoch. */
  due: number
}

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
  | {
      role: 'person'
      author: StoredMessageData['author']
      text: string
      at: number
    }
  | { role: 'assistant'; text: string; at: number }
  /** A schedule's prompt, set up earlier and submitted when due. */
  | { role: 'scheduled'; creator?: Author; text: string; at: number }

/** Who said what, for the entries people and the assistant wrote. */
export function saidBy(entry: EntryRecord): Said | undefined {
  const message = entry.model?.[0]

  if (!message) {
    return undefined
  }

  if (entry.kind === MESSAGE_KIND) {
    const data = entry.data as StoredMessageData
    return {
      role: 'person',
      author: data.author,
      text: data.text,
      at: message.timestamp,
    }
  }

  if (entry.kind === SCHEDULED_KIND) {
    const data = entry.data as Partial<ScheduledData> | undefined

    return {
      role: 'scheduled',
      creator: data?.creator,
      text: data?.prompt ?? textOf(message),
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

/**
 * Resolve a tool's author through its persisted call ancestry. The assistant
 * entry bounds the search, so later queued or placed messages cannot steal it.
 * Nested tools follow their parent, and scheduled runs retain their creator.
 */
export async function toolAuthor(
  tx: Tx,
  taskId: TaskId,
): Promise<Author | undefined> {
  const task = await tx.task(taskId)
  if (!task || task.kind !== 'pi.tool') {
    return undefined
  }
  const input = task.input as ToolTaskInput
  if (input.kind === 'nested') {
    return toolAuthor(tx, input.parent)
  }
  for await (const entry of entriesOf(tx, {
    conversationId: task.conversationId,
    maxEntryId: input.assistant,
  })) {
    if (entry.kind === MESSAGE_KIND) {
      const { author } = entry.data as StoredMessageData
      // A historical name cannot establish a person’s stable identity.
      return typeof author === 'string' ? undefined : author
    }
    if (entry.kind === SCHEDULED_KIND) {
      return (entry.data as ScheduledData).creator
    }
    // Other input, e.g. upkeep, has no person behind it. Compaction summaries
    // are history markers, not inputs, and must not hide the original author.
    if (
      !entry.head &&
      entry.model?.some((message) => message.role === 'user')
    ) {
      return undefined
    }
  }
  return undefined
}
