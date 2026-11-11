import {
  defineDoc,
  type ConversationId,
  type EntryId,
  type SubmissionId,
  type Tx,
} from '@earendil-works/pi-durable'
import { MESSAGE_LIMITS } from '../conversation/message.ts'
import { Familiars, type FamiliarId } from '../workspace/familiars.ts'

/**
 * Which rooms a workspace has, and which Familiars are in each. People talk
 * to Familiars in rooms: a DM is one Familiar and one person, a named room
 * one or more Familiars. People aren't members in core; the host decides
 * who may open which room.
 */

/** A room's ID: its log's conversation ID, as a Familiar's is its chat's. */
export type RoomId = ConversationId

export type DmRoom = {
  kind: 'dm'
  familiar: FamiliarId
  /** The person's host author ID. */
  person: string
}

export type NamedRoom = {
  kind: 'room'
  name: string
  /** In the room, in display order. */
  familiars: FamiliarId[]
  /**
   * Answers messages that address no one; one of `familiars`. Without one,
   * the room is open: every Familiar in it takes a turn on such a message,
   * one after another, in order.
   */
  lead?: FamiliarId
  /** Hidden and closed to new messages; its history is kept. */
  archived?: true
}

export type Room = DmRoom | NamedRoom

/** The rooms as stored; lists show each with more (see listing.ts). */
export type RoomRegistry = {
  /** By RoomId. Object keys are strings, so a key is `String(id)`. */
  rooms: Record<string, Room>
}

export const Rooms = defineDoc<RoomRegistry>({
  kind: 'familiar.rooms',
  version: 1,
  scope: 'session',
  initial: () => ({ rooms: {} }),
  checkpointWhen: () => true, // small: always store it whole
})

/** A turn a Familiar is taking in a room, by its task's ID (see turn.ts). */
export type TurnRecord = {
  room: RoomId
  familiar: FamiliarId
  /** Its name as the turn began, which its reply carries. */
  name: string
  /** The room entry it answers. */
  cause: EntryId
  /** Its input in the Familiar's chat, once delivered. */
  submission?: SubmissionId
}

/**
 * The turns in progress in every room, by turn task ID. Written only by
 * turn tasks, in the commits that change their phase, so a room's stream can
 * show who is working on it and follow each one's input in its Familiar's
 * chat. One document for the workspace, so its stream follows every room's
 * turns with one watch.
 */
export const Turns = defineDoc<Record<string, TurnRecord>>({
  kind: 'familiar.turns',
  version: 2,
  scope: 'session',
  initial: () => ({}),
  checkpointWhen: () => true, // a handful of turns at most
})

/** A change to the rooms the rules refuse; nothing was changed. */
export class RoomError extends TypeError {}

/** The longest name a room may have. */
const NAME_LENGTH = 100

/**
 * Whether `person`, a host author ID, sees `room`: every named room, and
 * only their own DMs. Without one, every room, as for a host's own work.
 */
export const seenBy = (room: Room, person: string | undefined) =>
  person === undefined || room.kind === 'room' || room.person === person

/** The Familiars in `room`. */
export const membersOf = (room: Room) =>
  room.kind === 'dm' ? [room.familiar] : room.familiars

/** What a named room is set up with; it's open without a `lead`. */
export type RoomSetup = Pick<NamedRoom, 'name' | 'familiars' | 'lead'>

/**
 * A change to a named room's setup; a `null` lead opens the room, and
 * `archived: false` unarchives it. Archiving has its own call, `archiveRoom`.
 */
export type RoomChange = Partial<Omit<RoomSetup, 'lead'>> & {
  lead?: FamiliarId | null
  archived?: false
}

/** `setup`, checked against the Familiars that exist; throws a RoomError. */
async function checkSetup(tx: Tx, setup: RoomSetup): Promise<RoomSetup> {
  const { name, familiars, lead } = setup
  if (typeof name !== 'string' || !name.trim() || name.length > NAME_LENGTH) {
    throw new RoomError(
      `A room needs a name of at most ${NAME_LENGTH} characters.`,
    )
  }
  const registry = (await tx.doc(Familiars)).familiars
  if (
    !Array.isArray(familiars) ||
    !familiars.length ||
    new Set(familiars).size !== familiars.length ||
    familiars.some((familiar) => !registry[familiar])
  ) {
    throw new RoomError('A room needs one or more distinct Familiars.')
  }
  if (lead !== undefined && !familiars.includes(lead)) {
    throw new RoomError("A room's lead must be one of its Familiars.")
  }
  return {
    name,
    familiars: [...familiars],
    ...(lead !== undefined && { lead }),
  }
}

/** A new room's log. */
async function createLog(tx: Tx) {
  const log = await tx.createConversation({ ownership: { kind: 'ownerless' } })
  return log.id as RoomId
}

/** A named room, by ID; throws a RoomError for a DM or no room. */
async function namedRoom(tx: Tx, id: RoomId) {
  const room = (await tx.doc(Rooms)).rooms[id]
  if (room?.kind !== 'room') {
    throw new RoomError(`No named room ${id}.`)
  }
  return room
}

export async function createRoom(tx: Tx, setup: RoomSetup) {
  const checked = await checkSetup(tx, setup)
  const rooms = await tx.doc(Rooms)
  const id = await createLog(tx)
  rooms.rooms[id] = { kind: 'room', ...checked }
  return id
}

/**
 * Changes a named room's setup; what's left out stays as it is. Unarchiving
 * checks the setup it reopens with, so a room its last Familiar left needs
 * Familiars in the same change.
 */
export async function updateRoom(tx: Tx, id: RoomId, change: RoomChange) {
  const room = await namedRoom(tx, id)
  const lead = change.lead === null ? undefined : (change.lead ?? room.lead)
  const checked = await checkSetup(tx, {
    name: change.name ?? room.name,
    familiars: change.familiars ?? room.familiars,
    ...(lead !== undefined && { lead }),
  })
  delete room.lead
  Object.assign(room, checked)
  if (change.archived === false) {
    delete room.archived
  }
}

export async function archiveRoom(tx: Tx, id: RoomId) {
  ;(await namedRoom(tx, id)).archived = true
}

/**
 * Takes a Familiar being removed out of every named room: a room it led
 * becomes open, and one it leaves without Familiars is archived. Its DMs
 * stay, closed to new messages once it's gone from the registry (see
 * `closedTo`).
 */
export async function leaveRooms(tx: Tx, familiar: FamiliarId) {
  for (const room of Object.values((await tx.doc(Rooms)).rooms)) {
    if (room.kind !== 'room' || !room.familiars.includes(familiar)) {
      continue
    }
    room.familiars = room.familiars.filter((other) => other !== familiar)
    if (room.lead === familiar) {
      delete room.lead
    }
    if (!room.familiars.length) {
      room.archived = true
    }
  }
}

/**
 * Why `room` takes no new messages, or undefined while it does: a named room
 * that was archived, or a DM whose Familiar was removed.
 */
export async function closedTo(tx: Tx, room: Room) {
  if (room.kind === 'room') {
    return room.archived ? `${room.name} is archived.` : undefined
  }
  return (await tx.doc(Familiars)).familiars[room.familiar]
    ? undefined
    : 'This Familiar was removed.'
}

/**
 * The DM between `familiar` and `person`, created if they have none. One per
 * pair: found by a scan in the same commit that would create it, as a
 * household has tens of rooms, not thousands.
 */
export async function dmWith(tx: Tx, familiar: FamiliarId, person: string) {
  if (
    typeof person !== 'string' ||
    !person.trim() ||
    person.length > MESSAGE_LIMITS.authorId
  ) {
    throw new RoomError(
      `A DM needs a person's ID of at most ${MESSAGE_LIMITS.authorId} characters.`,
    )
  }
  if (!(await tx.doc(Familiars)).familiars[familiar]) {
    throw new RoomError(`No Familiar ${familiar}.`)
  }
  const rooms = await tx.doc(Rooms)
  const found = Object.entries(rooms.rooms).find(
    ([, room]) =>
      room.kind === 'dm' &&
      room.familiar === familiar &&
      room.person === person,
  )
  if (found) {
    return Number(found[0]) as RoomId
  }
  const id = await createLog(tx)
  rooms.rooms[id] = { kind: 'dm', familiar, person }
  return id
}
