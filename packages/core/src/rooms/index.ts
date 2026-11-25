import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  defineExtension,
  type ConversationWatch,
  type ConversationWindow,
  type EntryQuery,
  type EntryRecord,
  type Cursor,
  type Page,
  type EntryId,
  type Harness,
  type WatchHandle,
} from '@earendil-works/pi-durable'
import { claimImages } from '../images/store.ts'
import type { ImageId } from '../images/types.ts'
import { declineWaiting } from '../questions/index.ts'
import {
  admitMessage,
  admitNote,
  MESSAGE_KIND,
  NOTE_KIND,
  SCHEDULED_KIND,
  type Author,
} from '../conversation/message.ts'
import type { PostScheduled } from '../schedules/task.ts'
import type { FamiliarId } from '../workspace/familiars.ts'
import { watchActivity, type RoomActivity } from './activity.ts'
import {
  listRooms,
  watchRooms,
  type RoomListing,
  type RoomsState,
} from './listing.ts'
import { markRead, post, retryTurn, type Mention } from './log.ts'
import {
  archiveRoom,
  createRoom,
  dmWith,
  Rooms,
  membersOf,
  seenBy,
  updateRoom,
  type RoomChange,
  type RoomId,
  type RoomSetup,
} from './rooms.ts'
import { createAnswer } from './answer.ts'
import { replyingIn } from './status.ts'
import { roomTools } from './tools.ts'
import { canDeliver, createTurnTask } from './turn.ts'

/** Pi's entry bounds and ordering, scoped to one room. */
export type HistoryQuery = Pick<
  EntryQuery,
  'minEntryId' | 'maxEntryId' | 'order'
>
export type HistoryPage = Page<EntryRecord, Cursor>

export type {
  HandoffData,
  Mention,
  NoteData,
  ReplyData,
  RoomMessageData,
  RoomPreview,
  RoomScheduledData,
} from './log.ts'
export { MAX_DEPTH, REPLY_KIND } from './log.ts'
export { RoomError } from './rooms.ts'
export type { Room, RoomChange, RoomId, RoomSetup } from './rooms.ts'
export type { RoomListing, RoomsState, RoomTurn } from './listing.ts'
export type { RoomActivity, TurnActivity } from './activity.ts'

/** A person's message to a room. */
export type RoomMessage = {
  /**
   * Who sent it, with a stable host ID and the name at send time. The model
   * sees both; pick a name it can address, such as a first name. It
   * attributes words; it grants nothing.
   */
  author: Author
  /** May be empty when it has images. */
  text: string
  /**
   * The images it carries, by the IDs `images.upload` gave them, at most
   * `IMAGE_LIMITS.count`. Posting claims them, so they're kept for good.
   * Shown in the room and to each Familiar the message is delivered to.
   */
  images?: readonly ImageId[]
  /**
   * Stable per logical message from this author, so a retried post is
   * admitted once. Scoped to the author: another author's same ID is a
   * different message. At most `MESSAGE_LIMITS.requestId` characters.
   */
  requestId: string
  /**
   * Whom it addresses, as picked by its author; Familiars must be in the
   * room. In a named room, the message goes to the Familiars it mentions,
   * or to all Familiars in the room if it mentions none. Each decides
   * whether to reply.
   */
  mentions?: Mention[]
}

/** One room: its log, the turns it has in progress, and Stop. */
export type RoomApi = {
  id: RoomId
  /**
   * Posts a message and starts the turns it causes; a retry with the same
   * request ID posts nothing. Returns its entry. Rejects with a MessageError
   * for a message `admitMessage` or the mention rules refuse, an ImageError
   * `missing` for an image that isn't stored, and a
   * RoomError for a closed room: an archived one, or a DM whose Familiar
   * was removed.
   */
  post(message: RoomMessage): Promise<EntryId>
  /**
   * Posts a host's note: shown in the room and to each Familiar in it on its
   * next turn, with no turn of its own, so no one replies. For context such
   * as "Sam joined". Bounded as a message is; a retry with the same request
   * ID posts nothing. Rejects with a MessageError for a note `admitNote`
   * refuses, and a RoomError for a closed room, as `post`.
   */
  note(note: { text: string; requestId: string }): Promise<EntryId>
  /**
   * Marks the room read by `person`, a host author ID, up to `entry`, the
   * newest they've seen; never back from where it was. Lists count what's
   * unread from here; a person's own messages mark it read up to them.
   */
  read(person: string, entry: EntryId): Promise<void>
  /** A bounded page of the room's entries, using Pi's query and page shapes. */
  history(query: HistoryQuery, limit: number): Promise<HistoryPage>
  /**
   * The log's committed view, then every commit's changes to it. `window`
   * is Pi's: by default the newest 50 entries, or from an entry, such as
   * right after the newest a client has.
   */
  watch(window?: ConversationWindow): Promise<ConversationWatch>
  /**
   * Its Familiars' work here, by FamiliarId: whether each has something
   * from here queued or is replying, with the reply as it streams. Shows
   * nothing of their work in other rooms.
   */
  watchTurns(): Promise<WatchHandle<RoomActivity>>
  /**
   * Tries a failed reply's turn again: its Familiar answers the same entry
   * anew, and the new reply follows in the log; the failed one stays.
   * Asking again while that turn is under way, or once it has replied,
   * starts nothing. Rejects with a RoomError for an entry that isn't a
   * failed reply here, a Familiar no longer in the room, or a closed room,
   * as `post`.
   */
  retry(reply: EntryId): Promise<void>
  /**
   * Stops every turn in this room: withdraws inputs still queued, and stops
   * the runs answering the others, keeping what they said. Other rooms'
   * work, in the same Familiars too, carries on.
   */
  stop(): Promise<void>
}

export type RoomSummary = RoomListing & { id: RoomId }

export type RoomsApi = {
  /**
   * Every room, archived ones included, flagged, as a list shows it: its
   * setup, newest entry and turns in progress. With `person`, a host author
   * ID, only those they see, every named room and their own DMs, with what
   * they haven't read.
   */
  list(person?: string): Promise<RoomSummary[]>
  /** The rooms as `list` shows them, by RoomId, then every change to that. */
  watch(person?: string): Promise<WatchHandle<RoomsState>>
  /**
   * A named room. Throws a RoomError for an invalid name or membership.
   */
  create(setup: RoomSetup): Promise<RoomId>
  /**
   * Changes a named room; what's left out stays, and
   * `archived: false` unarchives it, listed and open to messages again.
   * Throws a RoomError as `create`.
   */
  update(id: RoomId, change: RoomChange): Promise<void>
  /**
   * Hides a named room and closes it to new messages, keeping its history.
   * Stops queued and running turns. An answer that already finished
   * generating may still appear in the archive.
   */
  archive(id: RoomId): Promise<void>
  /** The DM between a Familiar and a person, by host author ID, created if new. */
  dm(familiar: FamiliarId, person: string): Promise<RoomId>
  /**
   * A room, or undefined if there's no such room. Given a `person`, by host
   * author ID, someone else's DM is no such room too: a DM is one person's,
   * whatever a host allows. Without one, every room, as for a host's own work.
   */
  get(id: RoomId, person?: string): Promise<RoomApi | undefined>
}

const context = BACKGROUND_CONTEXT

/**
 * Rooms: where people talk to Familiars. Install `extension` before the
 * Harness resumes; schedules post due reminders with `postScheduled`.
 */
export function createRooms(
  harness: Harness,
  options: {
    timeZone: string
    now: () => number
  },
) {
  const turn = createTurnTask(harness, options.timeZone)
  const answer = createAnswer(turn)

  const postScheduled: PostScheduled = async (tx, room, entry, requestId) =>
    (
      await post(
        tx,
        turn,
        room,
        { kind: SCHEDULED_KIND, data: entry },
        requestId,
      )
    ).turns

  // A room's turns are background tasks, which only a background abort reaches.
  const stop = async (id: RoomId) =>
    (await harness.conversation(id, context))!.abort(context, {
      background: true,
    })

  const open = (id: RoomId): RoomApi => ({
    id,
    post: async (message) => {
      const { author, text, images, requestId } = admitMessage(message)
      const posted = await harness.commit(async (tx) => {
        // Claimed with the post, or, if it fails, not at all.
        const refs = images && (await claimImages(tx, images))
        // A Familiar waiting on the person here gets this instead.
        const record = (await tx.doc(Rooms)).rooms[id]
        await declineWaiting(
          tx,
          record ? await replyingIn(tx, id, membersOf(record)) : [],
        )
        return post(
          tx,
          turn,
          id,
          {
            kind: MESSAGE_KIND,
            data: {
              author,
              text,
              ...(refs && { images: refs }),
              at: options.now(),
              ...(message.mentions && { mentions: message.mentions }),
            },
          },
          requestId,
        )
      }, context)
      return posted.entry
    },
    note: async (note) => {
      const { text, requestId } = admitNote(note)
      const posted = await harness.commit(
        (tx) =>
          post(
            tx,
            turn,
            id,
            { kind: NOTE_KIND, data: { text, at: options.now() } },
            requestId,
          ),
        context,
      )
      return posted.entry
    },
    retry: (reply) =>
      harness.commit(
        (tx) => retryTurn(tx, turn, id, reply, canDeliver),
        context,
      ),
    read: (person, entry) =>
      harness.commit((tx) => markRead(tx, id, person, entry), context),
    history: async (query, limit) =>
      (await harness.conversation(id, context))!.entries(
        query,
        limit,
        undefined,
        context,
      ),
    watch: async (window) =>
      (await harness.conversation(id, context))!.watch(context, window),
    watchTurns: () => watchActivity(harness, id),
    stop: () => stop(id),
  })

  const api: RoomsApi = {
    list: (person) => listRooms(harness, person),
    watch: (person) => watchRooms(harness, person),
    create: (setup) => harness.commit((tx) => createRoom(tx, setup), context),
    update: (id, change) =>
      harness.commit((tx) => updateRoom(tx, id, change), context),
    // Closed first, so nothing new starts, then what's under way stops.
    archive: async (id) => {
      await harness.commit((tx) => archiveRoom(tx, id), context)
      await stop(id)
    },
    dm: (familiar, person) =>
      harness.commit((tx) => dmWith(tx, familiar, person), context),
    get: async (id, person) => {
      const room = (await harness.snapshot(Rooms, context))?.rooms[id]
      return room && seenBy(room, person) ? open(id) : undefined
    },
  }

  return {
    extension: defineExtension({
      name: 'familiar.rooms',
      tasks: [turn, answer.task],
      tools: roomTools(),
      hooks: [answer.hook],
    }),
    postScheduled,
    api,
  }
}
