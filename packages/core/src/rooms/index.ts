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
  MESSAGE_KIND,
  SCHEDULED_KIND,
  type Author,
} from '../conversation/message.ts'
import type { PostScheduled } from '../schedules/task.ts'
import { viewWatch } from '../pi/watch.ts'
import type { FamiliarId } from '../workspace/familiars.ts'
import { watchActivity, type RoomActivity } from './activity.ts'
import { post, type Mention } from './log.ts'
import {
  archiveRoom,
  createRoom,
  dmWith,
  Rooms,
  updateRoom,
  type Room,
  type RoomChange,
  type RoomId,
  type RoomSetup,
  type RoomsState,
} from './rooms.ts'
import { roomTools } from './tools.ts'
import { createTurnTask } from './turn.ts'
import { historyOf, type HistoryPage } from '../pi/entries.ts'

export type {
  HandoffData,
  Mention,
  ReplyData,
  RoomMessageData,
  RoomScheduledData,
} from './log.ts'
export { REPLY_KIND } from './log.ts'
export { RoomError } from './rooms.ts'
export type {
  Room,
  RoomChange,
  RoomId,
  RoomSetup,
  RoomsState,
} from './rooms.ts'
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
   * RoomError for an archived room.
   */
  post(message: RoomMessage): Promise<EntryId>
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
   * Stops every turn in this room: withdraws inputs still queued, and stops
   * the runs answering the others, keeping what they said. Other rooms'
   * work, in the same Familiars too, carries on.
   */
  stop(): Promise<void>
}

export type RoomSummary = Room & { id: RoomId }

export type RoomsApi = {
  /**
   * Every room, archived ones included, flagged; with `person`, a host
   * author ID, only those they see: every named room, and their own DMs.
   */
  list(person?: string): Promise<RoomSummary[]>
  /** The registry, as `list` filters it, then every change to that. */
  watch(person?: string): Promise<WatchHandle<RoomsState>>
  /**
   * A named room, open unless it has a `lead`. Throws a RoomError for a
   * blank name, no Familiars, or a lead not among them.
   */
  create(setup: RoomSetup): Promise<RoomId>
  /**
   * Changes a named room; what's left out stays, and a `null` lead opens
   * it. Throws a RoomError as `create`.
   */
  update(id: RoomId, change: RoomChange): Promise<void>
  /** Hides a named room and closes it to new messages, keeping its history. */
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

/** The rooms `person` sees: every named room and their own DMs; all without one. */
function seenBy(
  state: Readonly<RoomsState> | null,
  person: string | undefined,
): RoomsState {
  const rooms = state?.rooms ?? {}
  return person === undefined
    ? { rooms }
    : {
        rooms: Object.fromEntries(
          Object.entries(rooms).filter(
            ([, room]) => room.kind === 'room' || room.person === person,
          ),
        ),
      }
}

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
    history: async (before, limit) =>
      historyOf((await harness.conversation(id, context))!, before, limit),
    watch: async () =>
      (await harness.conversation(id, context))!.watch(context),
    watchTurns: () => watchActivity(harness, id),
    // Its turns are background tasks, which only a background abort reaches.
    stop: async () =>
      (await harness.conversation(id, context))!.abort(context, {
        background: true,
      }),
  })

  const api: RoomsApi = {
    list: async (person) =>
      Object.entries(
        seenBy((await harness.snapshot(Rooms, context)) ?? null, person).rooms,
      ).map(([id, room]) => ({ id: Number(id) as RoomId, ...room })),
    // Opening the workspace creates the registry.
    watch: async (person) =>
      viewWatch((await harness.watchDoc(Rooms, context))!, (state) =>
        seenBy(state, person),
      ),
    create: (setup) => harness.commit((tx) => createRoom(tx, setup), context),
    update: (id, change) =>
      harness.commit((tx) => updateRoom(tx, id, change), context),
    archive: (id) => harness.commit((tx) => archiveRoom(tx, id), context),
    dm: (familiar, person) =>
      harness.commit((tx) => dmWith(tx, familiar, person), context),
    get: async (id, person) =>
      seenBy((await harness.snapshot(Rooms, context)) ?? null, person).rooms[id]
        ? open(id)
        : undefined,
  }

  return {
    extension: defineExtension({
      name: 'familiar.rooms',
      tasks: [turn],
      tools: roomTools(turn, options.maxHandoffs),
    }),
    postScheduled,
    api,
  }
}
