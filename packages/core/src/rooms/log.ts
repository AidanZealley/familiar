import type { Message } from '@earendil-works/pi-ai'
import {
  defineDoc,
  type EntryDraft,
  type EntryId,
  type TaskId,
  type Tx,
} from '@earendil-works/pi-durable'
import {
  formatAuthor,
  HANDOFF_KIND,
  MESSAGE_KIND,
  MESSAGE_LIMITS,
  MessageError,
  NOTE_KIND,
  SCHEDULED_KIND,
  textOf,
  type Addressed,
  type Author,
} from '../conversation/message.ts'
import { entriesOf } from '../pi/entries.ts'
import {
  Familiars,
  type FamiliarId,
  type FamiliarRecord,
} from '../workspace/familiars.ts'
import { knownAs, People } from '../workspace/people.ts'
import {
  closedTo,
  membersOf,
  RoomError,
  Rooms,
  type Room,
  type RoomId,
} from './rooms.ts'
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
  /** `quiet` when it chose to say nothing, with `stay_quiet`. */
  outcome: 'answered' | 'quiet' | 'failed' | 'stopped'
  /** Its run's assistant and tool-result messages, in order. */
  messages: Message[]
  /** When it was posted, in ms since the epoch. */
  at: number
}

/**
 * A Familiar asking another in the same room to take a turn, with
 * `hand_off`. The one it asks answers it as it would a message.
 */
export type HandoffData = {
  from: FamiliarId
  to: FamiliarId
  /** What it asks, for the one it asks. */
  note: string
  /** How many handoffs led here: one more than its cause's, if a handoff. */
  hops: number
  /** The room entry the handing-off turn answered. */
  cause: EntryId
  /** When it was posted, in ms since the epoch. */
  at: number
}

/** How a handoff starts, as the model reads it. */
const HANDOFF_PREFIX = '[Handoff from '

/** A handoff as the model reads it: who asked, by name, then the note. */
export const formatHandoff = (from: string, note: string) =>
  `${HANDOFF_PREFIX}${formatAuthor(from)}]\n${note}`

/** `formatHandoff` read back, or undefined for text it didn't write. */
export const readHandoff = (text: string) => {
  const match = /^\[Handoff from (.*)\]\n([\s\S]*)$/.exec(text)
  return match
    ? { from: JSON.parse(match[1]) as string, note: match[2] }
    : undefined
}

/** A host's note to a room: context for its Familiars, which no one answers. */
export type NoteData = {
  text: string
  /** When it was posted, in ms since the epoch, on the workspace's clock. */
  at: number
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
  | { kind: typeof HANDOFF_KIND; data: HandoffData }
  | { kind: typeof NOTE_KIND; data: NoteData }

/** What a reply says, without its tool calls: what a room shows of it. */
export const replyText = (reply: ReplyData) =>
  reply.messages
    .filter((message) => message.role === 'assistant')
    .map(textOf)
    .filter(Boolean)
    .join('\n')

/** How long a preview's text may be: a line in a list, not the whole entry. */
const PREVIEW_LENGTH = 160

/** `text` on one line, cut to `PREVIEW_LENGTH`. */
const excerpt = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > PREVIEW_LENGTH
    ? `${line.slice(0, PREVIEW_LENGTH - 1)}…`
    : line
}

/**
 * A room's newest entry worth showing, as a list previews it: who it's
 * from, the start of what it says, and when. A reply that stayed quiet
 * isn't worth showing; a failed one is, so a list can say the room's last
 * turn failed.
 */
export type RoomPreview = {
  entry: EntryId
  /** When it was posted, in ms since the epoch. */
  at: number
  /** The start of what it says, on one line. */
  text: string
} & (
  | { kind: 'message'; author: Author }
  | {
      kind: 'reply'
      familiar: FamiliarId
      /** Its name at the time. */
      name: string
      outcome: Exclude<ReplyData['outcome'], 'quiet'>
    }
  | {
      /** A handoff, from `familiar`, or `familiar`'s reminder falling due. */
      kind: 'handoff' | 'reminder'
      familiar: FamiliarId
      /** Its name at the time. */
      name: string
    }
  | { kind: 'note' }
)

/** `entry`, posted as `id`, as a list previews it; undefined if not worth showing. */
function previewOf(
  id: EntryId,
  entry: RoomEntry,
  familiars: Readonly<Record<string, FamiliarRecord>>,
): RoomPreview | undefined {
  const nameOf = (familiar: FamiliarId) => familiars[familiar]?.name ?? ''
  switch (entry.kind) {
    case MESSAGE_KIND: {
      const { author, text, at } = entry.data
      return { entry: id, at, text: excerpt(text), kind: 'message', author }
    }
    case REPLY_KIND: {
      const { familiar, name, outcome, at } = entry.data
      return outcome === 'quiet'
        ? undefined
        : {
            entry: id,
            at,
            text: excerpt(replyText(entry.data)),
            kind: 'reply',
            familiar,
            name,
            outcome,
          }
    }
    case HANDOFF_KIND: {
      const { from, note, at } = entry.data
      return {
        entry: id,
        at,
        text: excerpt(note),
        kind: 'handoff',
        familiar: from,
        name: nameOf(from),
      }
    }
    case SCHEDULED_KIND: {
      const { familiar, prompt, due, late } = entry.data
      return {
        entry: id,
        at: late ?? due,
        text: excerpt(prompt),
        kind: 'reminder',
        familiar,
        name: nameOf(familiar),
      }
    }
    case NOTE_KIND:
      return {
        entry: id,
        at: entry.data.at,
        text: excerpt(entry.data.text),
        kind: 'note',
      }
  }
}

/**
 * How far a person has read a room: up to `entry`, by which point the room
 * had shown `count` entries. What's unread is the room's count since.
 */
export type ReadMarker = { entry: EntryId; count: number }

/**
 * What a room's log has shown: its newest entry worth showing, how many it
 * has shown, and how far each person has read it, by host author ID. One
 * value, so a list never sees a post without its author having read it.
 */
export type RoomShown = {
  last: RoomPreview
  count: number
  read: Record<string, ReadMarker>
}

/**
 * What each room's log has shown, by RoomId. Derived from each entry as
 * it's appended, in the same commit (see `noteShown`), so lists can preview
 * every room, sort them and count what's unread without reading their logs.
 */
export const Shown = defineDoc<Record<string, RoomShown>>({
  kind: 'familiar.shown',
  version: 1,
  scope: 'session',
  initial: () => ({}),
  checkpointWhen: () => true, // small: always store it whole
})

/**
 * Records `entry`, just appended to `room` as `id`, as what the room last
 * showed, in the commit that appends it. Every entry a room shows comes
 * through here: `post`, and adopting a chat. A person has read what they
 * wrote, so their own message moves their marker to it.
 */
export async function noteShown(
  tx: Tx,
  room: RoomId,
  id: EntryId,
  entry: RoomEntry,
) {
  const preview = previewOf(id, entry, (await tx.doc(Familiars)).familiars)
  if (!preview) {
    return
  }
  const shown = await tx.doc(Shown)
  const count = (shown[room]?.count ?? 0) + 1
  shown[room] = {
    last: preview,
    count,
    read: {
      ...shown[room]?.read,
      ...(entry.kind === MESSAGE_KIND && {
        [entry.data.author.id]: { entry: id, count },
      }),
    },
  }
}

/**
 * Marks `room` read by `person` up to entry `upTo`, the newest they've
 * seen; never back from where it was. Entries posted since still count as
 * unread, so one that arrives as they read isn't lost.
 */
export async function markRead(
  tx: Tx,
  room: RoomId,
  person: string,
  upTo: EntryId,
) {
  const shown = (await tx.doc(Shown))[room]
  const marker = shown?.read[person]
  if (!shown || (marker && upTo <= marker.entry)) {
    return
  }
  // Reads before writes: a transaction cannot read tables after writing.
  let since = 0
  if (upTo < shown.last.entry) {
    for await (const entry of entriesOf(tx, {
      conversationId: room,
      minEntryId: (upTo + 1) as EntryId,
      order: 'ascending',
    })) {
      if (previewOf(entry.id, entry as unknown as RoomEntry, {})) {
        since++
      }
    }
  }
  shown.read[person] = {
    entry: Math.min(upTo, shown.last.entry) as EntryId,
    count: shown.count - since,
  }
}

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
 * Who takes a turn for `entry`, and why, decided once, as it's posted: a
 * DM's Familiar; in a named room, each Familiar mentioned, once, in order,
 * else the lead, else, in an open room, every Familiar in it; a reminder's
 * own Familiar; the one a handoff asks. Replies and notes never cause turns.
 */
function recipients(
  room: Room,
  entry: RoomEntry,
): { familiar: FamiliarId; addressed: Addressed }[] {
  const all = (familiars: FamiliarId[], addressed: Addressed) =>
    familiars.map((familiar) => ({ familiar, addressed }))
  switch (entry.kind) {
    case REPLY_KIND:
    case NOTE_KIND:
      return []
    case SCHEDULED_KIND:
      return all([entry.data.familiar], 'schedule')
    case HANDOFF_KIND:
      return all([entry.data.to], 'handoff')
  }
  if (room.kind === 'dm') {
    return all([room.familiar], 'dm')
  }
  const mentioned = new Set(
    (entry.data.mentions ?? [])
      .filter((mention) => mention.kind === 'familiar')
      .map((mention) => Number(mention.id) as FamiliarId),
  )
  return mentioned.size
    ? all([...mentioned], 'mention')
    : room.lead !== undefined
      ? all([room.lead], 'lead')
      : all(room.familiars, 'open')
}

/**
 * A room's log never compacts, so its view, which a room's stream sends
 * whole, would grow forever. Past this many entries a marker moves the
 * view's start forward to keep the newest `VIEW_KEEP`, as compaction does
 * for a chat, and clients page back through `history` as they do there.
 */
const VIEW_LIMIT = 200
const VIEW_KEEP = 100

/** The kind of the marker that starts a room's view, which shows nothing. */
export const VIEW_KIND = 'familiar.view'

/**
 * Where a room's view should start, given its entries since it last did,
 * oldest first: undefined while there are fewer than VIEW_LIMIT.
 */
export const viewStart = (entries: readonly EntryId[]) =>
  entries.length < VIEW_LIMIT ? undefined : entries[entries.length - VIEW_KEEP]

/** Starts `room`'s view at `head`, keeping everything after it in view. */
export const startView = (tx: Tx, room: RoomId, head: EntryId) =>
  tx.appendEntry(room, { kind: VIEW_KIND, head })

/**
 * What a turn task is given: whose turn, in which room, for which entry, and
 * why. An open room's turns go one after another: each but the first waits
 * for the turn `after` it to end, so it's shown that turn's reply.
 */
export type TurnInput = {
  room: RoomId
  familiar: FamiliarId
  cause: EntryId
  addressed: Addressed
  after?: TaskId<TurnResult>
}

/** A turn's result: the reply it posted, if any. */
export type TurnResult = { reply: EntryId | null }

/** An entry to post, with the request that caused it: a retry finds it by this. */
export type Posting = { entry: RoomEntry; requestId: string }

/**
 * Posts `entry` to `room`'s log, with `requestId` saying what caused it,
 * and creates the turns it causes, all in the commit `tx`: a message and
 * the work it causes are stored together or not at all. A retry finds the
 * entry already posted and creates nothing. Throws a MessageError for
 * mentions `checkMentions` refuses, and a RoomError for no room, or for
 * anything but a reply in a room `closedTo` closes.
 */
export async function post(
  tx: Tx,
  turn: TurnTask,
  room: RoomId,
  entry: RoomEntry,
  requestId: string,
) {
  const [posted] = await postAll(tx, turn, room, [{ entry, requestId }])
  return posted
}

/**
 * Posts each of `postings` to `room`'s log in order, as `post` does one, in
 * the one commit `tx`: how a turn files its reply and then the handoffs it
 * made, so each handoff follows the reply it came from.
 */
export async function postAll(
  tx: Tx,
  turn: TurnTask,
  room: RoomId,
  postings: readonly Posting[],
): Promise<{ entry: EntryId; turns: TaskId<TurnResult>[] }[]> {
  // Reads before writes: a transaction cannot read tables after writing.
  const posted: (EntryId | undefined)[] = []
  for (const { requestId } of postings) {
    posted.push((await tx.submissionByRequest(room, requestId))?.entry)
  }
  const fresh = postings.filter((_, index) => posted[index] === undefined)
  if (!fresh.length) {
    return posted.map((entry) => ({ entry: entry!, turns: [] }))
  }
  const record = (await tx.doc(Rooms)).rooms[room]
  if (!record) {
    throw new RoomError(`No room ${room}.`)
  }
  // A turn that was under way still files its reply.
  const closed = fresh.every(({ entry }) => entry.kind === REPLY_KIND)
    ? undefined
    : await closedTo(tx, record)
  if (closed) {
    throw new RoomError(closed)
  }
  for (const { entry } of fresh) {
    if (entry.kind === MESSAGE_KIND) {
      // Signed with the name the person chose, if they have.
      entry.data.author = knownAs(await tx.doc(People), entry.data.author)
      if (entry.data.mentions) {
        entry.data.mentions = checkMentions(
          record,
          entry.data.text,
          entry.data.mentions,
        )
      }
    }
  }
  // The entries in view, newest first, up to as many as could need moving.
  const head = (await tx.latestHeadMarker(room))?.head
  const { items } = await tx.scanEntries(
    {
      conversationId: room,
      order: 'descending',
      ...(head !== undefined && { minEntryId: head }),
    },
    VIEW_LIMIT,
  )
  const inView = items
    .filter((item) => item.head === undefined)
    .reverse()
    .map((item) => item.id)

  const results = []
  for (const [index, { entry, requestId }] of postings.entries()) {
    const already = posted[index]
    if (already !== undefined) {
      results.push({ entry: already, turns: [] })
      continue
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
    await noteShown(tx, room, appended.id, entry)
    inView.push(appended.id)

    const turns: TaskId<TurnResult>[] = []
    for (const { familiar, addressed } of recipients(record, entry)) {
      const after = addressed === 'open' ? turns.at(-1) : undefined
      // Background: a room's Stop aborts them, and nothing waits for a room.
      turns.push(
        await tx.createTask(
          turn,
          {
            room,
            familiar,
            cause: appended.id,
            addressed,
            ...(after !== undefined && { after }),
          },
          {
            ownership: { kind: 'conversation' },
            conversationId: room,
            background: true,
          },
        ),
      )
    }
    results.push({ entry: appended.id, turns })
  }
  const start = viewStart(inView)
  if (start !== undefined) {
    await startView(tx, room, start)
  }
  return results
}
