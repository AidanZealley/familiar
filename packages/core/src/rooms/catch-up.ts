import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import {
  defineDocFamily,
  type EntryId,
  type EntryRecord,
  type Tx,
} from '@earendil-works/pi-durable'
import {
  HANDOFF_KIND,
  MESSAGE_KIND,
  NOTE_KIND,
  type Addressed,
} from '../conversation/message.ts'
import {
  familiarDoc,
  Familiars,
  type FamiliarId,
  type FamiliarsState,
} from '../workspace/familiars.ts'
import {
  REPLY_KIND,
  replyText,
  type HandoffData,
  type NoteData,
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
 * replies with nothing said, such as a quiet one, and `own` replies when the
 * Familiar's chat already has them. A note is a host's, so it has no
 * speaker. A handoff names both Familiars as they
 * are called now, or says one was removed. Continuation lines are indented, so no one's words can
 * pass for another line.
 */
function line(
  entry: EntryRecord,
  own: FamiliarId | undefined,
  { familiars }: Readonly<FamiliarsState>,
) {
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
  if (entry.kind === HANDOFF_KIND) {
    const { from, to, note } = entry.data as HandoffData
    const name = (familiar: FamiliarId) =>
      familiars[familiar]?.name ?? 'a removed assistant'
    return said(`${name(from)} → ${name(to)}`, note)
  }
  if (entry.kind === NOTE_KIND) {
    return said('Note', (entry.data as NoteData).text)
  }
  return undefined
}

/**
 * The lines of `room`'s entries from `min` to `max` (or the newest), newest
 * kept within `budget`, oldest first, with their entries' IDs, leaving out
 * `skip`'s replies.
 */
async function lines(
  tx: Tx,
  room: RoomId,
  // Entry IDs are ascending integers.
  range: { min?: number; max?: number },
  budget: number,
  skip?: FamiliarId,
) {
  if (
    range.min !== undefined &&
    range.max !== undefined &&
    range.min > range.max
  ) {
    return []
  }
  const registry = await tx.doc(Familiars)
  const kept: { id: EntryId; text: string }[] = []
  let tokens = 0
  for await (const entry of entriesOf(tx, {
    conversationId: room,
    minEntryId: range.min as EntryId | undefined,
    maxEntryId: range.max as EntryId | undefined,
  })) {
    const text = line(entry, skip, registry)
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

/** Why a Familiar has a turn in a named room, as its first line says it. */
const why: Record<Addressed, string> = {
  dm: '',
  schedule: '',
  mention: ', where you were mentioned',
  lead: ', which you lead',
  open: ', where everyone takes a turn',
  handoff: ', handed to you',
}

/**
 * Where a turn is, and why the Familiar has it, as the first line of what
 * it's shown.
 */
const where = (room: Room, person: string | undefined, addressed: Addressed) =>
  room.kind === 'room'
    ? `[In #${room.name}${why[addressed]}]`
    : person === undefined
      ? '[In your DM]'
      : `[In your DM with ${person}]`

/**
 * What `familiar` is shown of `room` for its turn on `cause`: what it missed
 * before `cause`, and what was said after it before the turn began, such as
 * an open room's earlier replies. Shown in the commit that moves its cursor
 * past all of it, so a rerun can't show it twice. `person` is the name of
 * who the DM is with, when the cause says. A cursor only moves forward, so a
 * turn prepared after a later one shows nothing again.
 */
export async function catchUp(
  tx: Tx,
  familiar: FamiliarId,
  room: RoomId,
  record: Room,
  cause: EntryId,
  person: string | undefined,
  addressed: Addressed,
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
  const since = await lines(
    tx,
    room,
    { min: Math.max(seen ?? 0, cause) + 1 },
    UNSEEN_TOKENS,
    familiar,
  )

  cursors.rooms[room] = Math.max(
    seen ?? 0,
    cause,
    since.at(-1)?.id ?? 0,
  ) as EntryId
  cursors.last = room

  return [
    where(record, person, addressed),
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
    ...(since.length
      ? [
          "Said here since what you're answering:",
          ...since.map((line) => line.text),
        ]
      : []),
  ].join('\n')
}
