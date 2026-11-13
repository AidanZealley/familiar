import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import type { EntryId, Tx } from '@earendil-works/pi-durable'
import {
  MESSAGE_KIND,
  saidBy,
  type Author,
  type InRoom,
} from '../../conversation/message.ts'
import type { RoomMessageData } from '../../rooms/log.ts'
import type { RoomId, RoomRegistry } from '../../rooms/rooms.ts'
import { entriesOf } from '../../pi/entries.ts'
import { localDay, weekdayMinute } from '../../time.ts'
import type { FamiliarId } from '../../workspace/familiars.ts'
import { knownAs, type PeopleState } from '../../workspace/people.ts'
import {
  clipText,
  isCurrent,
  LIMITS,
  normalized,
  SELF,
  STANDING_TEXT,
  standingOf,
  type MemoryState,
  type Note,
  type PageState,
  type Subject,
} from '../store.ts'

/**
 * A batch: the person messages filing reads in one call, and how the call
 * is shown them. Only people's own messages are numbered, so only their
 * words can be cited; everything else is context.
 */

/** A message filing may cite, with everything applying needs to check it. */
export type BatchMessage = {
  /** Its number in the call. */
  m: number
  entry: EntryId
  author: Author
  room?: RoomId
  at: number
  text: string
  /** People's lines a room showed with it: their words can be quoted too. */
  shown: { author: Author; text: string }[]
  /** Someone asked for it to be remembered (`remember`). */
  asked: boolean
}

export type Batch = {
  messages: BatchMessage[]
  /** The last entry it covers, which becomes filing's progress mark. */
  through: EntryId
  /** The pages it showed the model, the only notes its operations may name. */
  pages: string[]
  /** What the model is given. */
  input: string
}

/**
 * A batch holds one local day's messages, at most this many of them or this
 * many tokens of their words: small batches file more steadily.
 */
export const BATCH = { messages: 20, tokens: 6_000 }

/** Filing reads a message once it is this old, so the conversation has settled. */
export const SETTLE_MS = 10 * 60 * 1000

/**
 * A long reply or other input is shown as its start and its end, which is
 * where a reply usually asks what the person's next message answers.
 */
const CONTEXT = { head: 120, tail: 240 }

/** How many earlier room entries are searched for the lines a message was shown with. */
const SHOWN_SCAN = 60

const shorten = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > CONTEXT.head + CONTEXT.tail + 1
    ? `${flat.slice(0, CONTEXT.head)}…${flat.slice(-CONTEXT.tail)}`
    : flat
}

/**
 * The people's lines a room showed with a message: the room's messages from
 * before it whose words its context holds, with their authors, which the
 * context itself names only by display name.
 */
async function shownWith(
  tx: Tx,
  room: RoomId,
  before: EntryId,
  context: string,
  people: Readonly<PeopleState>,
) {
  const shown: BatchMessage['shown'] = []
  const haystack = normalized(context)
  let scanned = 0
  for await (const entry of entriesOf(tx, {
    conversationId: room,
    maxEntryId: (before - 1) as EntryId,
    order: 'descending',
  })) {
    if (++scanned > SHOWN_SCAN) {
      break
    }
    if (entry.kind !== MESSAGE_KIND) {
      continue
    }
    const { author, text } = entry.data as RoomMessageData
    if (text.trim() && haystack.includes(normalized(text))) {
      shown.unshift({ author: knownAs(people, author), text })
    }
  }
  return shown
}

/** Where a message was said, as filing and recall show it. */
export function placeOf(
  rooms: Readonly<RoomRegistry>,
  room: RoomId | undefined,
) {
  const record = room === undefined ? undefined : rooms.rooms[room]
  return record?.kind === 'room' ? `#${record.name}` : 'a DM'
}

type Line =
  { message: BatchMessage } | { context: string; at: number; who: string }

/**
 * The next batch after `through`: unfiled person messages at least
 * SETTLE_MS old, or asked to be remembered, oldest first, from one day in
 * `timeZone`, within BATCH. Authors are named as `people` names them now.
 * Empty `messages` with an `end` means only entries with nothing to file
 * came first, so the mark can move past them. Reads only, so a commit may
 * write after it.
 */
export async function nextBatch(
  tx: Tx,
  familiar: FamiliarId,
  { through, asked }: { through: EntryId | null; asked: readonly EntryId[] },
  {
    now,
    timeZone,
    people,
  }: {
    now: number
    timeZone: string
    people: Readonly<PeopleState>
  },
) {
  const lines: Line[] = []
  const messages: BatchMessage[] = []
  let end: EntryId | undefined
  let tokens = 0
  let day: string | undefined
  // A message asked to be remembered is filed now, with those before it.
  const askedThrough = Math.max(-1, ...asked)
  for await (const entry of entriesOf(tx, {
    conversationId: familiar,
    order: 'ascending',
    ...(through !== null && { minEntryId: (through + 1) as EntryId }),
  })) {
    const said = saidBy(entry)
    if (said?.role === 'person') {
      const settled = said.at <= now - SETTLE_MS || entry.id <= askedThrough
      if (!settled) {
        break
      }
      const size = estimateTextTokens(said.text)
      day ??= localDay(said.at, timeZone)
      if (
        messages.length &&
        (messages.length >= BATCH.messages ||
          tokens + size > BATCH.tokens ||
          localDay(said.at, timeZone) !== day)
      ) {
        break
      }
      const room = (entry.data as InRoom).room
      const message: BatchMessage = {
        m: messages.length + 1,
        entry: entry.id,
        author: knownAs(people, said.author),
        ...(room !== undefined && { room }),
        at: said.at,
        // One message too long for a batch is cut to fit.
        text:
          size > BATCH.tokens
            ? said.text.slice(0, BATCH.tokens * 3)
            : said.text,
        shown:
          said.context && room !== undefined
            ? await shownWith(tx, room, entry.id, said.context, people)
            : [],
        asked: asked.includes(entry.id),
      }
      messages.push(message)
      lines.push({ message })
      tokens += size
    } else if (said && messages.length) {
      // Replies, reminders and handoffs follow the conversation: never evidence.
      lines.push({
        context: shorten(said.text),
        at: said.at,
        who:
          said.role === 'assistant'
            ? 'reply'
            : said.role === 'scheduled'
              ? 'reminder'
              : `handoff from ${said.from}`,
      })
    }
    end = entry.id
  }
  return { messages, lines, end }
}

export type Selected = Awaited<ReturnType<typeof nextBatch>>

/**
 * Gives each person in `messages` who has no page one, linked by ID, so
 * the call that files their first messages already shows it; and names
 * every person's page as the workspace (`people`) names them now, so a
 * rename reaches memory and a backlog of older messages can't undo it.
 * The model only ever makes subjects for those who don't take part.
 */
export function meetPeople(
  memory: MemoryState,
  people: Readonly<PeopleState>,
  messages: readonly BatchMessage[],
  now: number,
) {
  for (const subject of memory.subjects) {
    const name =
      subject.participant?.kind === 'person'
        ? people.names[subject.participant.id]
        : undefined
    if (name && subject.name !== clipText(name, LIMITS.name)) {
      subject.name = clipText(name, LIMITS.name)
    }
  }
  for (const author of messages.flatMap((message) => [
    message.author,
    ...message.shown.map((shown) => shown.author),
  ])) {
    if (
      !memory.subjects.some(
        (subject) =>
          subject.participant?.kind === 'person' &&
          subject.participant.id === author.id,
      )
    ) {
      memory.subjects.push({
        id: `s${memory.next.subject++}`,
        kind: 'person',
        name: clipText(knownAs(people, author).name, LIMITS.name),
        aliases: [],
        participant: { kind: 'person', id: author.id },
        line: '',
        changed: now,
      })
    }
  }
}

const indent = (text: string, by: string) => text.replace(/^/gm, by)

/** A note as filing and consolidation show it. */
export function describeNote(
  note: Note,
  subject: Subject,
  rooms: Readonly<RoomRegistry>,
) {
  const said =
    subject.participant?.kind === 'person' &&
    subject.participant.id === note.saidBy.id
      ? `said by ${note.saidBy.name} themselves`
      : `said by ${note.saidBy.name}`
  const days = note.until
    ? `${note.since} to ${note.until}`
    : `since ${note.since}`
  return `${note.id} (${note.kind}, ${days}, ${said} in ${placeOf(rooms, note.room)}, ${STANDING_TEXT[standingOf(note)]}): ${note.text}\n    Rests on: "${note.quote}"`
}

/** A subject on the roster. */
export const rosterLine = (subject: Subject) =>
  `${subject.id} ${subject.name}${subject.kind === 'self' ? ' (you)' : ` (${subject.kind}${subject.participant ? ', takes part' : ''})`}${subject.line && subject.kind !== 'self' ? `: ${subject.line}` : ''}${subject.aliases.length ? `; also ${subject.aliases.join(', ')}` : ''}`

/** The roster filing sees: at most this many characters, most recently changed first. */
const FILING_ROSTER = 8_000

/** The subjects a batch's words name, by name or alias, and its authors'. */
export function touched(
  memory: MemoryState,
  messages: readonly BatchMessage[],
) {
  const text = ` ${normalized(
    messages
      .flatMap((message) => [message.text, ...message.shown.map((s) => s.text)])
      .join(' '),
  )} `
  const people = new Set(
    messages.flatMap((message) => [
      message.author.id,
      ...message.shown.map((shown) => shown.author.id),
    ]),
  )
  return memory.subjects
    .filter(
      (subject) =>
        subject.id === SELF ||
        (subject.participant?.kind === 'person' &&
          people.has(subject.participant.id)) ||
        [subject.name, ...subject.aliases].some((name) => {
          const words = normalized(name)
          return words && text.includes(` ${words} `)
        }),
    )
    .map((subject) => subject.id)
}

/** The input filing's call is given. */
export function renderBatch(
  selected: Pick<Selected, 'lines'>,
  memory: MemoryState,
  pages: ReadonlyMap<string, Readonly<PageState>>,
  rooms: Readonly<RoomRegistry>,
  name: string,
  timeZone: string,
) {
  const said = selected.lines.map((line) => {
    if ('context' in line) {
      return `(${name}'s ${line.who}, context only) ${line.context}`
    }
    const { message } = line
    return [
      `[m${message.m}] ${message.author.name}, in ${placeOf(rooms, message.room)}, ${weekdayMinute(message.at, timeZone)}:`,
      indent(message.text, '    '),
      ...(message.shown.length
        ? [
            '    Shown from the room with it, said by others:',
            ...message.shown.map(
              (shown) =>
                `      [${shown.author.name}]: ${shown.text.replace(/\n/g, '\n        ')}`,
            ),
          ]
        : []),
    ].join('\n')
  })

  const roster: string[] = []
  let size = 0
  const shown = new Set(pages.keys())
  for (const subject of [...memory.subjects].sort(
    (a, b) =>
      Number(shown.has(b.id)) - Number(shown.has(a.id)) ||
      b.changed - a.changed,
  )) {
    const line = rosterLine(subject)
    if (size + line.length > FILING_ROSTER) {
      break
    }
    roster.push(line)
    size += line.length + 1
  }

  const touchedPages = memory.subjects.flatMap((subject) => {
    const page = pages.get(subject.id)
    if (!page) {
      return []
    }
    const notes = page.notes.filter(isCurrent)
    return [
      [
        `${subject.id} ${subject.name}`,
        `Profile: ${page.profile || '(none yet)'}`,
        notes.length
          ? `Notes:\n${notes.map((note) => `  ${describeNote(note, subject, rooms)}`).join('\n')}`
          : 'Notes: (none)',
      ].join('\n'),
    ]
  })

  return [
    'Messages, oldest first:',
    said.join('\n'),
    '',
    'Roster:',
    roster.join('\n'),
    '',
    'Pages these messages touch:',
    touchedPages.join('\n\n'),
  ].join('\n')
}
