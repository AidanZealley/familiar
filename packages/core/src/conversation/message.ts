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
import {
  checkImage,
  IMAGE_LIMITS,
  type ImageProblem,
  type ImageRefusal,
} from './image.ts'

/** The entry kind people's messages are stored as. */
export const MESSAGE_KIND = 'familiar.message'

/** A completed background MCP invocation, delivered as its own follow-up. */
export const MCP_COMPLETION_KIND = 'familiar.mcp-completion'

export type McpCompletionData = InRoom & { author?: Author }

/** Host-owned identity with a display name captured at send time. */
export type Author = {
  /** Stable host-owned identity, unchanged across devices and renames. */
  id: string
  /** Display name when this message was sent. */
  name: string
}

/**
 * A person's message as stored, without parsing the model's copy. `images`
 * counts what it carried: the model's copy has the images themselves.
 */
export type MessageData = {
  author: Author
  text: string
  images?: number
} & InRoom

/**
 * How a room input addresses this Familiar.
 */
export type Addressed = 'dm' | 'mention' | 'open' | 'handoff' | 'schedule'

/**
 * Where a Familiar was shown an input: the room it came from, the room entry
 * it answers, what the Familiar was shown from that room with it (see
 * rooms/turn.ts), and why it has the turn. Absent for a reminder delivered
 * straight to its chat (see schedules/task.ts).
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

/**
 * An image a message carries, as the model takes it inline: pi-ai's
 * `ImageContent`, as a type so it's JSON an entry can store.
 */
export type MessageImage = { type: 'image'; data: string; mimeType: string }

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * `images` as a message stores them, each with the format its bytes show,
 * whatever it was labelled. Throws a MessageError for too many, too large,
 * not base64, or an image `checkImage` refuses, with the image's problem
 * as data.
 */
function admitImages(images: unknown): MessageImage[] {
  if (!Array.isArray(images) || images.length > IMAGE_LIMITS.count) {
    throw new MessageError(
      `A message may carry at most ${IMAGE_LIMITS.count} images.`,
    )
  }
  return images.map((image: { data?: unknown } | null, index) => {
    const data = image?.data
    if (
      typeof data !== 'string' ||
      data.length > IMAGE_LIMITS.bytes ||
      data.length % 4 !== 0 ||
      !BASE64.test(data)
    ) {
      throw new MessageError(
        `Each image must be base64 of at most ${IMAGE_LIMITS.bytes} characters.`,
      )
    }
    const header = checkImage(
      Uint8Array.from(atob(data), (char) => char.charCodeAt(0)),
    )
    if (typeof header === 'string') {
      throw new MessageError(IMAGE_PROBLEMS[header], {
        index,
        problem: header,
      })
    }
    return { type: 'image', data, mimeType: header.mimeType }
  })
}

/** Fallback wording for callers that show a MessageError as it is. */
const IMAGE_PROBLEMS: Record<ImageProblem, string> = {
  format: 'Each image must be a PNG, JPEG, GIF or WebP.',
  corrupt: "An image couldn't be read; it may be truncated or damaged.",
  pixels: `Each image's longest side must be at most ${IMAGE_LIMITS.pixels} pixels.`,
  frames: `An animated image may have at most ${IMAGE_LIMITS.frames} frames.`,
}

/**
 * `text` with how many images came with it, as the model reads a message it
 * isn't shown the images of: in catch-up, and as memory files it. Model-facing
 * only; hosts get the count as data and word it themselves.
 */
export function withImages(text: string, images = 0) {
  if (!images) {
    return text
  }
  const marker = `[${images} image${images === 1 ? '' : 's'}]`
  return text ? `${text} ${marker}` : marker
}

/**
 * A message the admission rules refuse; nothing was sent. `image` says
 * which image was refused and why, when one was, for a host to word.
 */
export class MessageError extends TypeError {
  readonly image?: ImageRefusal

  constructor(message: string, image?: ImageRefusal) {
    super(message)
    this.image = image
  }
}

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
 * Checks the words and request ID every message and note carries, and returns
 * them. Throws a MessageError for `what` they don't fit. `empty` allows no
 * words, as for a message of images alone.
 */
function admitText(
  what: string,
  { text, requestId }: { text: string; requestId: string },
  empty = false,
) {
  const words =
    empty && typeof text === 'string' && !text.trim()
      ? ''
      : bounded(text, MESSAGE_LIMITS.text)
        ? text
        : undefined
  if (words === undefined) {
    throw new MessageError(
      `${what} needs text, of at most ${MESSAGE_LIMITS.text} characters.`,
    )
  }
  if (
    typeof requestId !== 'string' ||
    !requestId ||
    requestId.length > MESSAGE_LIMITS.requestId
  ) {
    throw new MessageError(
      `${what} needs a requestId of at most ${MESSAGE_LIMITS.requestId} characters.`,
    )
  }
  return { text: words, requestId }
}

/**
 * The single admission check for a person's message: a valid author, words
 * within bounds, images as `admitImages` allows, and a bounded request ID.
 * Words may be left out only when it has images. Throws a MessageError
 * otherwise.
 */
export function admitMessage(message: {
  author: Author
  text: string
  requestId: string
  images?: readonly { data: string; mimeType?: string }[]
}) {
  const author = authorSnapshot(message.author)
  const images = message.images === undefined ? [] : admitImages(message.images)
  const { text, requestId } = admitText('A message', message, !!images.length)
  return {
    author,
    text,
    ...(images.length && { images }),
    requestId: personRequestId(author, requestId),
  }
}

/**
 * The admission check for a host's note to a room: the same bounds as a
 * message, with no author. The request ID is namespaced as a person's is, so
 * no note's retry can collide with a message or Familiar's own submission.
 */
export function admitNote(note: { text: string; requestId: string }) {
  const { text, requestId } = admitText('A note', note)
  return { text, requestId: `note:${JSON.stringify(requestId)}` }
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
 * The input a generation request answers, read from its entry so the words
 * are exactly as sent, without the room's context or the model copy's
 * header. Undefined outside a request, or for an input `saidBy` doesn't
 * read, such as memory's.
 */
export async function answeredInput(tx: Tx, taskId: TaskId) {
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
      const said = saidBy(entry)
      return said?.role === 'assistant' ? undefined : said
    }
  }

  return undefined
}

/**
 * The entry kind for stored handoffs in room logs and Familiar chats.
 */
export const HANDOFF_KIND = 'familiar.handoff'

/**
 * The entry kind another Familiar's reply in a room is placed as in the chat
 * of a Familiar it's delivered to (see rooms/turn.ts).
 */
export const RELAY_KIND = 'familiar.relay'

/**
 * A Familiar's reply as placed in another's chat: who said it, by ID and by
 * name then, and what it said.
 */
export type RelayData = InRoom & {
  familiar: ConversationId
  name: string
  text: string
}

/**
 * The entry kind a host's note to a room is posted as: context for the
 * Familiars in it, which causes no turn (see rooms/log.ts).
 */
export const NOTE_KIND = 'familiar.note'

/** The entry kind a schedule's prompt is submitted as when it falls due. */
export const SCHEDULED_KIND = 'familiar.scheduled'

export type ScheduledData = InRoom & {
  scheduleId: string
  creator?: Author
  prompt: string
  /** The time it was scheduled for, in ms since the epoch. */
  due: number
}

/**
 * A stored handoff names the Familiar who made it and what they asked.
 */
export type HandedOnData = InRoom & {
  from: ConversationId
  name: string
  note: string
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

/**
 * An input: what starts a Familiar's run, and an exchange in its memory.
 * `context` is what it was shown from the room with the input, said by
 * whoever each line names, never by the input's sender.
 */
type Input = { text: string; context?: string; at: number }

export type Said =
  | ({ role: 'person'; author: Author } & Input)
  /** A schedule's prompt, set up earlier and submitted when due. */
  | ({ role: 'scheduled'; creator?: Author } & Input)
  /** Another Familiar's note, handing a room's conversation on (old entries). */
  | ({ role: 'handoff'; from: string } & Input)
  /** Another Familiar's reply in a room, by its name then. */
  | ({ role: 'familiar'; from: string } & Input)
  | { role: 'assistant'; text: string; at: number }

/**
 * A room's context, if it shows anything: its first line says only where
 * the turn was, then what was said there. Without the rest it has nothing
 * to file.
 */
const shown = (data: InRoom | undefined) =>
  data?.context?.includes('\n') ? { context: data.context } : {}

/** Who said what, for the entries people and the assistant wrote. */
export function saidBy(entry: EntryRecord): Said | undefined {
  const message = entry.model?.[0]

  if (!message) {
    return undefined
  }
  const at = message.timestamp

  if (entry.kind === MESSAGE_KIND) {
    const data = entry.data as MessageData
    return {
      role: 'person',
      author: data.author,
      text: withImages(data.text, data.images),
      ...shown(data),
      at,
    }
  }

  if (entry.kind === SCHEDULED_KIND) {
    const data = entry.data as Partial<ScheduledData> | undefined

    return {
      role: 'scheduled',
      ...(data?.creator && { creator: data.creator }),
      text: data?.prompt ?? textOf(message),
      ...shown(data),
      at,
    }
  }

  if (entry.kind === HANDOFF_KIND) {
    const data = entry.data as HandedOnData

    return {
      role: 'handoff',
      from: data.name,
      text: data.note,
      ...shown(data),
      at,
    }
  }

  if (entry.kind === RELAY_KIND) {
    const data = entry.data as RelayData

    return {
      role: 'familiar',
      from: data.name,
      text: data.text,
      ...shown(data),
      at,
    }
  }

  if (entry.kind === 'pi.assistant') {
    const text = textOf(message)

    // A reply that only called tools has nothing to show.
    return text ? { role: 'assistant', text, at: message.timestamp } : undefined
  }

  return undefined
}
