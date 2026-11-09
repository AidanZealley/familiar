import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  defineExtension,
  type ConversationWatch,
  type DocumentWatch,
  type EntryId,
  type Harness,
} from '@earendil-works/pi-durable'
import { historyOf, type HistoryPage } from '../conversation/index.ts'
import {
  admitMessage,
  MESSAGE_KIND,
  SCHEDULED_KIND,
  type Author,
} from '../conversation/message.ts'
import type { PostScheduled } from '../schedules/task.ts'
import type { FamiliarId } from '../workspace/familiars.ts'
import { post, type Mention } from './log.ts'
import {
  archiveRoom,
  createRoom,
  dmWith,
  Rooms,
  Turns,
  updateRoom,
  type Room,
  type RoomId,
  type RoomSetup,
  type TurnRecord,
} from './rooms.ts'
import { createTurnTask } from './turn.ts'

export type { Mention, ReplyData, RoomMessageData } from './log.ts'
export { REPLY_KIND } from './log.ts'
export { RoomError } from './rooms.ts'
export type { Room, RoomId, RoomSetup, TurnRecord } from './rooms.ts'

/** A person's message to a room. */
export type RoomMessage = {
  /** Who sent it, as for a Familiar's chat (see `Message`). */
  author: Author
  text: string
  /** Scoped to the author, as for a Familiar's chat. */
  requestId: string
  /**
   * Whom it addresses, as picked by its author; Familiars must be in the
   * room. In a named room, mentioned Familiars answer, else the lead.
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
  /** Older entries of the log, as a Familiar's chat's `history`. */
  history(before: EntryId, limit: number): Promise<HistoryPage>
  /** The log's committed view, then every commit's changes to it. */
  watch(): Promise<ConversationWatch>
  /**
   * The turns in progress here, by task ID, with each one's input in its
   * Familiar's chat once delivered, to follow in that chat's live state.
   */
  watchTurns(): Promise<DocumentWatch<Record<string, TurnRecord>>>
  /**
   * Stops every turn in this room: withdraws inputs still queued, and stops
   * the runs answering the others, keeping what they said. Other rooms'
   * work, in the same Familiars too, carries on.
   */
  stop(): Promise<void>
}

export type RoomSummary = Room & { id: RoomId }

export type RoomsApi = {
  /** Every room, archived ones included, flagged; hosts choose whom to show which. */
  list(): Promise<RoomSummary[]>
  /** Throws a RoomError for a blank name, no Familiars, or a lead not among them. */
  create(setup: RoomSetup): Promise<RoomId>
  /** Changes a named room; what's left out stays. Throws a RoomError as `create`. */
  update(id: RoomId, change: Partial<RoomSetup>): Promise<void>
  /** Hides a named room and closes it to new messages, keeping its history. */
  archive(id: RoomId): Promise<void>
  /** The DM between a Familiar and a person, by host author ID, created if new. */
  dm(familiar: FamiliarId, person: string): Promise<RoomId>
  /** A room, or undefined if there's no such room. */
  get(id: RoomId): Promise<RoomApi | undefined>
}

const context = BACKGROUND_CONTEXT

/**
 * Rooms: where people talk to Familiars. Install `extension` before the
 * Harness resumes; schedules post due reminders with `postScheduled`.
 */
export function createRooms(harness: Harness, options: { timeZone: string }) {
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
    // Every room's log is created with it.
    watchTurns: async () => (await harness.watchDoc(Turns, id, context))!,
    // Its turns are background tasks, which only a background abort reaches.
    stop: async () =>
      (await harness.conversation(id, context))!.abort(context, {
        background: true,
      }),
  })

  const api: RoomsApi = {
    list: async () =>
      Object.entries((await harness.snapshot(Rooms, context))?.rooms ?? {}).map(
        ([id, room]) => ({ id: Number(id) as RoomId, ...room }),
      ),
    create: (setup) => harness.commit((tx) => createRoom(tx, setup), context),
    update: (id, change) =>
      harness.commit((tx) => updateRoom(tx, id, change), context),
    archive: (id) => harness.commit((tx) => archiveRoom(tx, id), context),
    dm: (familiar, person) =>
      harness.commit((tx) => dmWith(tx, familiar, person), context),
    get: async (id) =>
      (await harness.snapshot(Rooms, context))?.rooms[id]
        ? open(id)
        : undefined,
  }

  return {
    extension: defineExtension({ name: 'familiar.rooms', tasks: [turn] }),
    postScheduled,
    api,
  }
}
