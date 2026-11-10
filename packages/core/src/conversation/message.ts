import type { Message } from '@earendil-works/pi-ai'
import type {
  ConversationId,
  EntryId,
  EntryRecord,
  GenerationCheckpoint,
  TaskId,
  Tx,
} from '@earendil-works/pi-durable'
import { entriesOf } from '../pi/entries.ts'

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
export type MessageData = { author: Author; text: string } & InRoom

/**
 * Why a Familiar has a turn in a room, decided by routing as the entry is
 * posted (see rooms/log.ts): its DM; a mention; as the room's lead; an open
 * room, where every Familiar gets a turn on what addresses no one; another
 * Familiar's handoff; or its own reminder.
 */
export type Addressed =
  'dm' | 'mention' | 'lead' | 'open' | 'handoff' | 'schedule'

/**
 * Where a Familiar was shown an input: the room it came from, the room entry
 * it answers, what the Familiar was shown from that room with it (see
 * rooms/turn.ts), and why it has the turn. Absent for input sent straight to
 * its chat, as before rooms.
 */
export type InRoom = {
  room?: ConversationId
  entry?: EntryId
  context?: string
  addressed?: Addressed
}

/**
 * Bounds on what a message may carry, enforced by `admitMessage` for every
 * caller, HTTP or not. Text is in UTF-16 code units, as JavaScript counts.
 */
export const MESSAGE_LIMITS = {
  /**
   * An input-size policy, not a token budget: room for anything a person
   * would paste, while keeping what one message stores bounded. Longer
   * messages are refused, not cut.
   */
  text: 128_000,
  requestId: 128,
  authorId: 256,
  authorName: 128,
} as const

/** A message the admission rules refuse; nothing was sent. */
export class MessageError extends TypeError {}

const bounded = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= limit

/** Reject malformed host identities rather than admitting an unattributed message. */
export function authorSnapshot(author: Author): Author {
  if (
    !bounded(author?.id, MESSAGE_LIMITS.authorId) ||
    !bounded(author.name, MESSAGE_LIMITS.authorName)
  ) {
    throw new MessageError(
      `An author requires a non-empty id and name, of at most ${MESSAGE_LIMITS.authorId} and ${MESSAGE_LIMITS.authorName} characters.`,
    )
  }
  return { id: author.id, name: author.name }
}

/**
 * The conversation's request ID for a person's message. A caller's ID is only
 * unique to its author, so it is namespaced by the author's stable ID: two
 * people can't collide, a retry by the same author is still admitted once,
 * and no caller can name Familiar's own submissions, which use other
 * prefixes, such as a schedule's `schedule:`. JSON keeps the pair unambiguous
 * whatever either contains.
 */
const personRequestId = (author: Author, requestId: string) =>
  `person:${JSON.stringify([author.id, requestId])}`

/**
 * The single admission check for a person's message: a valid author, words
 * within bounds and a bounded request ID. Throws a MessageError otherwise.
 */
export function admitMessage(message: {
  author: Author
  text: string
  requestId: string
}) {
  const author = authorSnapshot(message.author)
  if (!bounded(message.text, MESSAGE_LIMITS.text)) {
    throw new MessageError(
      `A message needs text, of at most ${MESSAGE_LIMITS.text} characters.`,
    )
  }
  if (
    typeof message.requestId !== 'string' ||
    !message.requestId ||
    message.requestId.length > MESSAGE_LIMITS.requestId
  ) {
    throw new MessageError(
      `A message needs a requestId of at most ${MESSAGE_LIMITS.requestId} characters.`,
    )
  }
  return {
    author,
    text: message.text,
    requestId: personRequestId(author, message.requestId),
  }
}

/**
 * An author, or just a name, as JSON that stays on one line even when a host
 * supplies control characters.
 */
export const formatAuthor = (author: Author | string) =>
  JSON.stringify(author).replace(
    /[\u007f-\u009f\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )

/**
 * What the model sees for a person's message: a first line naming the author,
 * then their words unchanged. The author is a JSON string, with Unicode line
 * breaks escaped too, so no name can end the line or the quotes early.
 */
export const formatMessage = ({
  author,
  text,
}: Pick<MessageData, 'author' | 'text'>) =>
  `[Message from ${formatAuthor(author)}]\n${text}`

/** `formatMessage` read back, or undefined for text it didn't write. */
export const readMessage = (
  text: string,
): Pick<MessageData, 'author' | 'text'> | undefined => {
  const match = /^\[Message from (.*)\]\n([\s\S]*)$/.exec(text)
  return match
    ? { author: JSON.parse(match[1]) as Author, text: match[2] }
    : undefined
}

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
        ? (entry.data as MessageData)
        : undefined
    }
  }

  return undefined
}

/**
 * The entry kind a Familiar's handoff to another is posted as in a room, and
 * placed as in the chat of the one it asks (see rooms/tools.ts).
 */
export const HANDOFF_KIND = 'familiar.handoff'

/** The entry kind a schedule's prompt is submitted as when it falls due. */
export const SCHEDULED_KIND = 'familiar.scheduled'

export type ScheduledData = InRoom & {
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
      author: Author
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
    const data = entry.data as MessageData
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
