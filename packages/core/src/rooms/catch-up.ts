import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import {
  defineDocFamily,
  type EntryId,
  type EntryRecord,
  type Tx,
} from '@earendil-works/pi-durable'
import { MESSAGE_KIND } from '../conversation/message.ts'
import { familiarDoc, type FamiliarId } from '../workspace/familiars.ts'
import {
  REPLY_KIND,
  replyText,
  type ReplyData,
  type RoomMessageData,
} from './log.ts'
import type { Room, RoomId } from './rooms.ts'
import { entriesOf } from '../pi/entries.ts'

/**
 * What a Familiar is shown of a room when it takes a turn there. Its chat
 * never receives a room's messages one by one: each turn's input is rebuilt
 * from the room log, from where its last turn there left off.
 */

export type RoomCursorsState = {
  /** By RoomId: the newest room entry the Familiar has been shown. */
  rooms: Record<string, EntryId>
  /** The room of its last turn. */
  last?: RoomId
}

/** A Familiar's place in each room, keyed by its ID (see `familiarDoc`). */
export const RoomCursors = defineDocFamily<RoomCursorsState, null>({
  kind: 'familiar.room-cursors',
  version: 1,
  scope: 'session',
  family: true,
  initial: () => ({ rooms: {} }),
  checkpointWhen: () => true, // small: always store it whole
})

/**
 * About how much of what it missed a Familiar is shown, newest kept: enough
 * for a busy afternoon without one turn costing a whole context.
 */
const UNSEEN_TOKENS = 8_000

/**
 * About how much from before its cursor a Familiar is shown on coming back
 * to a room after working in another, so the thread reads naturally even if
 * its chat compacted it away.
 */
const EARLIER_TOKENS = 1_500

/**
 * An entry as a catch-up line, or undefined for what isn't shown: reminders,
 * and `own` replies when the Familiar's chat already has them. Continuation
 * lines are indented, so no one's words can pass for another line.
 */
function line(entry: EntryRecord, own: FamiliarId | undefined) {
  const said = (name: string, text: string) =>
    text ? `[${name}]: ${text.replace(/\n/g, '\n  ')}` : undefined
  if (entry.kind === MESSAGE_KIND) {
    const data = entry.data as RoomMessageData
    return said(data.author.name, data.text)
  }
  if (entry.kind === REPLY_KIND) {
    const data = entry.data as unknown as ReplyData
    return data.familiar === own ? undefined : said(data.name, replyText(data))
  }
  return undefined
}

/**
 * The lines of `room`'s entries from `min` to `max`, newest kept within
 * `budget`, oldest first, with their entries' IDs, leaving out `skip`'s
 * replies.
 */
async function lines(
  tx: Tx,
  room: RoomId,
  // Entry IDs are ascending integers.
  range: { min?: number; max: number },
  budget: number,
  skip?: FamiliarId,
) {
  if (range.min !== undefined && range.min > range.max) {
    return []
  }
  const kept: { id: EntryId; text: string }[] = []
  let tokens = 0
  for await (const entry of entriesOf(tx, {
    conversationId: room,
    minEntryId: range.min as EntryId | undefined,
    maxEntryId: range.max as EntryId,
  })) {
    const text = line(entry, skip)
    if (text === undefined) {
      continue
    }
    tokens += estimateTextTokens(text)
    if (tokens > budget) {
      break
    }
    kept.unshift({ id: entry.id, text })
  }
  return kept
}

/** Where a turn is, as the first line of what the Familiar is shown. */
const where = (room: Room, person: string | undefined) =>
  room.kind === 'room'
    ? `[In #${room.name}]`
    : person === undefined
      ? '[In your DM]'
      : `[In your DM with ${person}]`

/**
 * What `familiar` is shown of `room` before `cause`, in the commit that
 * moves its cursor past `cause`, so a rerun can't show it twice. `person` is
 * the name of who the DM is with, when the cause says. A cursor only moves
 * forward, so a turn prepared after a later one shows nothing again.
 */
export async function catchUp(
  tx: Tx,
  familiar: FamiliarId,
  room: RoomId,
  record: Room,
  cause: EntryId,
  person: string | undefined,
) {
  // Reads before writes: a transaction cannot read tables after writing.
  const cursors = await familiarDoc(tx, RoomCursors, familiar)
  const seen = cursors.rooms[room]
  const unseen = await lines(
    tx,
    room,
    { min: seen === undefined ? undefined : seen + 1, max: cause - 1 },
    UNSEEN_TOKENS,
    familiar,
  )
  // Up to what it missed, including its own replies there, which its chat
  // has but may since have compacted away.
  const earlier =
    cursors.last !== room && seen !== undefined
      ? await lines(
          tx,
          room,
          { max: (unseen[0]?.id ?? cause) - 1 },
          EARLIER_TOKENS,
        )
      : []

  cursors.rooms[room] = Math.max(seen ?? 0, cause) as EntryId
  cursors.last = room

  return [
    where(record, person),
    ...(earlier.length
      ? ['Earlier in this room:', ...earlier.map((line) => line.text)]
      : []),
    ...(unseen.length
      ? [
          seen === undefined
            ? 'Said here before:'
            : 'Said here since your last turn:',
          ...unseen.map((line) => line.text),
        ]
      : []),
  ].join('\n')
}
