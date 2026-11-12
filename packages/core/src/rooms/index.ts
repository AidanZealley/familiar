import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  defineExtension,
  type ConversationWatch,
  type EntryId,
  type Harness,
  type WatchHandle,
} from '@earendil-works/pi-durable'
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
  seenBy,
  updateRoom,
  type RoomChange,
  type RoomId,
  type RoomSetup,
} from './rooms.ts'
import { roomTools } from './tools.ts'
import { createTurnTask } from './turn.ts'
import { historyOf, type HistoryPage } from '../pi/entries.ts'

export type {
  HandoffData,
  Mention,
  NoteData,
  ReplyData,
  RoomMessageData,
  RoomPreview,
  RoomScheduledData,
} from './log.ts'
export { REPLY_KIND } from './log.ts'
export { RoomError } from './rooms.ts'
export type { Room, RoomChange, RoomId, RoomSetup } from './rooms.ts'
export type { RoomListing, RoomsState, RoomTurn } from './listing.ts'
export { checkMaxHandoffs, DEFAULT_MAX_HANDOFFS } from './tools.ts'
export type { RoomActivity, TurnActivity } from './activity.ts'

/** A person's message to a room. */
export type RoomMessage = {
  /**
   * Who sent it, with a stable host ID and the name at send time. The model
   * sees both; pick a name it can address, such as a first name. It
   * attributes words; it grants nothing.
   */
  author: Author
  text: string
  /**
   * Stable per logical message from this author, so a retried post is
   * admitted once. Scoped to the author: another author's same ID is a
   * different message. At most `MESSAGE_LIMITS.requestId` characters.
   */
  requestId: string
  /**
   * Whom it addresses, as picked by its author; Familiars must be in the
   * room. In a named room, mentioned Familiars answer, else the lead, else,
   * in an open room, each Familiar in turn.
   */
  mentions?: Mention[]
}

/** One room: its log, the turns it has in progress, and Stop. */
export type RoomApi = {
  id: RoomId
  /**
   * Posts a message and starts the turns it causes; a retry with the same
   * request ID posts nothing. Returns its entry. Rejects with a MessageError
   * for a message `admitMessage` or the mention rules refuse, and a
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
  /**
   * Up to `limit` committed entries older than entry `before`, newest first.
   * `more` says whether older ones exist.
   */
  history(before: EntryId, limit: number): Promise<HistoryPage>
  /** The log's committed view, then every commit's changes to it. */
  watch(): Promise<ConversationWatch>
  /**
   * The turns in progress here, by task ID: whether each is waiting for its
   * Familiar or being answered, with the reply as it streams. Shows nothing
   * of the Familiars' work in other rooms.
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
   * A named room, open unless it has a `lead`. Throws a RoomError for a
   * blank name, no Familiars, or a lead not among them.
   */
  create(setup: RoomSetup): Promise<RoomId>
  /**
   * Changes a named room; what's left out stays, a `null` lead opens it, and
   * `archived: false` unarchives it, listed and open to messages again.
   * Throws a RoomError as `create`.
   */
  update(id: RoomId, change: RoomChange): Promise<void>
  /**
   * Hides a named room and closes it to new messages, keeping its history,
   * and stops its turns in progress and queued, so no reply lands in it.
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
    /** Checked by `checkMaxHandoffs`. */
    maxHandoffs: number
  },
) {
  const turn = createTurnTask(harness, options.timeZone)

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
      const { author, text, requestId } = admitMessage(message)
      const posted = await harness.commit(
        (tx) =>
          post(
            tx,
            turn,
            id,
            {
              kind: MESSAGE_KIND,
              data: {
                author,
                text,
                at: options.now(),
                ...(message.mentions && { mentions: message.mentions }),
              },
            },
            requestId,
          ),
        context,
      )
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
      harness.commit((tx) => retryTurn(tx, turn, id, reply), context),
    read: (person, entry) =>
      harness.commit((tx) => markRead(tx, id, person, entry), context),
    history: async (before, limit) =>
      historyOf((await harness.conversation(id, context))!, before, limit),
    watch: async () =>
      (await harness.conversation(id, context))!.watch(context),
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
      tasks: [turn],
      tools: roomTools(options.maxHandoffs),
    }),
    postScheduled,
    api,
  }
}
