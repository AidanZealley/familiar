import type { Message } from '@earendil-works/pi-ai'
import type {
  EntryDraft,
  EntryId,
  TaskId,
  Tx,
} from '@earendil-works/pi-durable'
import {
  MESSAGE_KIND,
  MESSAGE_LIMITS,
  MessageError,
  SCHEDULED_KIND,
  textOf,
  type Author,
} from '../conversation/message.ts'
import type { FamiliarId } from '../workspace/familiars.ts'
import { membersOf, RoomError, Rooms, type Room, type RoomId } from './rooms.ts'
import type { TurnTask } from './turn.ts'

/**
 * A room's log: an ownerless conversation that never runs a model. Its
 * entries are display-only (no `model`), so Pi never queues them, and
 * `post` is the only way in.
 */

/**
 * Someone a message addresses, picked by its author rather than parsed from
 * the text: the span of `@Name` in the text, and whom it names.
 */
export type Mention = {
  kind: 'familiar' | 'person'
  /** A FamiliarId as a string, or a person's host author ID. */
  id: string
  start: number
  end: number
}

/** A person's message in a room. */
export type RoomMessageData = {
  author: Author
  text: string
  /**
   * When it was posted, in ms since the epoch, on the workspace's clock. A
   * room's entries have no model message to carry a time, as a chat's do.
   */
  at: number
  mentions?: Mention[]
}

/** The entry kind a Familiar's reply is copied into a room as. */
export const REPLY_KIND = 'familiar.reply'

/** A Familiar's handling of one room entry, copied from its chat once over. */
export type ReplyData = {
  familiar: FamiliarId
  /** Its name at the time. */
  name: string
  /** The room entry it answers. */
  cause: EntryId
  outcome: 'answered' | 'failed' | 'stopped'
  /** Its run's assistant and tool-result messages, in order. */
  messages: Message[]
}

/** A room's record of a reminder falling due; a turn answers it like a message. */
export type RoomScheduledData = {
  familiar: FamiliarId
  scheduleId: string
  prompt: string
  /** The time it was scheduled for, in ms since the epoch. */
  due: number
  /** When it was delivered, if late. */
  late?: number
  creator?: Author
}

export type RoomEntry =
  | { kind: typeof MESSAGE_KIND; data: RoomMessageData }
  | { kind: typeof REPLY_KIND; data: ReplyData }
  | { kind: typeof SCHEDULED_KIND; data: RoomScheduledData }

/** What a reply says, without its tool calls: what a room shows of it. */
export const replyText = (reply: ReplyData) =>
  reply.messages
    .filter((message) => message.role === 'assistant')
    .map(textOf)
    .filter(Boolean)
    .join('\n')

/**
 * `mentions`, if each one's span is inside `text` and starts with `@`, and
 * each Familiar it names is in `room`. Throws a MessageError otherwise.
 */
export function checkMentions(
  room: Room,
  text: string,
  mentions: readonly Mention[],
): Mention[] {
  if (!Array.isArray(mentions)) {
    throw new MessageError('Mentions must be a list.')
  }
  const members = membersOf(room).map(String)
  return mentions.map(({ kind, id, start, end }) => {
    const spanned =
      Number.isSafeInteger(start) &&
      Number.isSafeInteger(end) &&
      start >= 0 &&
      start < end &&
      end <= text.length &&
      text[start] === '@'
    const named =
      typeof id === 'string' &&
      (kind === 'familiar'
        ? members.includes(id)
        : kind === 'person' && !!id && id.length <= MESSAGE_LIMITS.authorId)
    if (!spanned || !named) {
      throw new MessageError(
        'Each mention must span an @name in the text and name a Familiar in this room or a person.',
      )
    }
    return { kind, id, start, end }
  })
}

/**
 * Who takes a turn for `entry`, decided once, as it's posted: a DM's
 * Familiar; in a named room, each Familiar mentioned, once, in order, or the
 * lead if none is; a reminder's own Familiar. Replies never cause turns.
 */
function recipients(room: Room, entry: RoomEntry): FamiliarId[] {
  if (entry.kind === REPLY_KIND) {
    return []
  }
  if (entry.kind === SCHEDULED_KIND) {
    return [entry.data.familiar]
  }
  if (room.kind === 'dm') {
    return [room.familiar]
  }
  const mentioned = new Set(
    (entry.data.mentions ?? [])
      .filter((mention) => mention.kind === 'familiar')
      .map((mention) => Number(mention.id) as FamiliarId),
  )
  return mentioned.size ? [...mentioned] : [room.lead]
}

/** What a turn task is given: whose turn, in which room, for which entry. */
export type TurnInput = { room: RoomId; familiar: FamiliarId; cause: EntryId }

/** A turn's result: the reply it posted, if any. */
export type TurnResult = { reply: EntryId | null }

/**
 * Posts `entry` to `room`'s log, with `requestId` saying what caused it,
 * and creates the turns it causes, all in the commit `tx`: a message and
 * the work it causes are stored together or not at all. A retry finds the
 * entry already posted and creates nothing. Throws a MessageError for
 * mentions `checkMentions` refuses, and a RoomError for no room, or a new
 * message or reminder in an archived one.
 */
export async function post(
  tx: Tx,
  turn: TurnTask,
  room: RoomId,
  entry: RoomEntry,
  requestId: string,
): Promise<{ entry: EntryId; turns: TaskId<TurnResult>[] }> {
  // Reads before writes: a transaction cannot read tables after writing.
  const posted = await tx.submissionByRequest(room, requestId)
  if (posted?.entry !== undefined) {
    return { entry: posted.entry, turns: [] }
  }
  const record = (await tx.doc(Rooms)).rooms[room]
  if (!record) {
    throw new RoomError(`No room ${room}.`)
  }
  if (record.kind === 'room' && record.archived && entry.kind !== REPLY_KIND) {
    throw new RoomError(`${record.name} is archived.`)
  }
  if (entry.kind === MESSAGE_KIND && entry.data.mentions) {
    entry.data.mentions = checkMentions(
      record,
      entry.data.text,
      entry.data.mentions,
    )
  }

  // Raw admission: a room never runs, so admitting a write is appending it.
  const submission = await tx.createSubmission({
    type: 'write',
    conversationId: room,
    requestId,
    status: 'queued',
  })
  // A reply's messages are JSON as stored in the chat; Pi's types don't say so.
  const appended = await tx.appendEntry(room, entry as EntryDraft)
  tx.placeSubmission(submission.id, appended.id)

  const turns: TaskId<TurnResult>[] = []
  for (const familiar of recipients(record, entry)) {
    // Background: a room's Stop aborts them, and nothing waits for a room.
    turns.push(
      await tx.createTask(
        turn,
        { room, familiar, cause: appended.id },
        {
          ownership: { kind: 'conversation' },
          conversationId: room,
          background: true,
        },
      ),
    )
  }
  return { entry: appended.id, turns }
}
