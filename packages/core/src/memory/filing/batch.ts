import type { ToolResultMessage } from '@earendil-works/pi-ai'
import type { EntryId, Tx } from '@earendil-works/pi-durable'
import {
  MESSAGE_KIND,
  saidBy,
  textOf,
  type Author,
  type InRoom,
} from '../../conversation/message.ts'
import { entriesOf } from '../../pi/entries.ts'
import type { RoomMessageData } from '../../rooms/log.ts'
import type { RoomId, RoomRegistry } from '../../rooms/rooms.ts'
import {
  SCHEDULE_CHANGES,
  type SchedulesState,
} from '../../schedules/schedules.ts'
import { weekdayMinute } from '../../time.ts'
import type { FamiliarId } from '../../workspace/familiars.ts'
import { knownAs, type PeopleState } from '../../workspace/people.ts'
import { placeOf } from '../exchanges.ts'
import {
  clipText,
  LIMITS,
  normalized,
  type MemoryState,
  type PageState,
  type Subject,
} from '../store.ts'

/**
 * A batch: the person messages filing reads in one call, and how the call
 * shows them. Only people's messages are numbered, so only their words can
 * be quoted; what the Familiar did between them is context.
 */

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
}

/** A batch holds at most this many person messages. */
export const BATCH_SIZE = 20

/** A message longer than this is cut, so one pasted document can't fill the call. */
const MESSAGE_CHARS = 18_000

/** A reply is shown as its start and end, where it usually asks what the next message answers. */
const CONTEXT = { head: 120, tail: 240 }

/** How much of a schedule's prompt is shown: enough to see what the job is. */
const SCHEDULE_SHOWN = 240

/** How many earlier room entries are searched for the lines a message was shown with. */
const SHOWN_SCAN = 60

/** The roster filing sees, in characters. */
const FILING_ROSTER = 8_000

const shorten = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > CONTEXT.head + CONTEXT.tail + 1
    ? `${flat.slice(0, CONTEXT.head)}…${flat.slice(-CONTEXT.tail)}`
    : flat
}

/** The room's messages before `before` whose words the room context a message came with holds. */
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

type Line = { message: BatchMessage } | { context: string; label: string }

/**
 * The next batch after `through`: up to BATCH_SIZE person messages, oldest
 * first, with what the Familiar did between them. `end` is the last entry
 * it covers; with no messages, only entries with nothing to file were left.
 */
export async function nextBatch(
  tx: Tx,
  familiar: FamiliarId,
  through: EntryId | null,
  people: Readonly<PeopleState>,
) {
  const lines: Line[] = []
  const messages: BatchMessage[] = []
  let end: EntryId | undefined
  for await (const entry of entriesOf(tx, {
    conversationId: familiar,
    order: 'ascending',
    ...(through !== null && { minEntryId: (through + 1) as EntryId }),
  })) {
    const said = saidBy(entry)
    if (said?.role === 'person') {
      if (messages.length === BATCH_SIZE) {
        break
      }
      const room = (entry.data as InRoom).room
      const message: BatchMessage = {
        m: messages.length + 1,
        entry: entry.id,
        author: knownAs(people, said.author),
        ...(room !== undefined && { room }),
        at: said.at,
        text: said.text.slice(0, MESSAGE_CHARS),
        shown:
          said.context && room !== undefined
            ? await shownWith(tx, room, entry.id, said.context, people)
            : [],
      }
      messages.push(message)
      lines.push({ message })
    } else if (said && messages.length) {
      lines.push({
        context: shorten(said.text),
        label:
          said.role === 'handoff'
            ? `handoff from ${said.from}`
            : said.role === 'assistant'
              ? 'its reply'
              : 'it ran a scheduled job',
      })
    } else if (messages.length && entry.kind === 'pi.tool-result') {
      // A reply that set up, changed or cancelled a schedule: the schedule
      // keeps what was asked for, so filing must see that it does.
      const result = entry.model?.[0] as ToolResultMessage | undefined
      if (result && !result.isError && SCHEDULE_CHANGES.has(result.toolName)) {
        lines.push({
          context: clipText(textOf(result), SCHEDULE_SHOWN),
          label: 'it changed its schedules, which now keep this',
        })
      }
    }
    end = entry.id
  }
  return { messages, lines, end }
}

export type Selected = Awaited<ReturnType<typeof nextBatch>>

/**
 * Gives each person in `messages` without a page one, linked by ID, and
 * names every person's page as the workspace names them now.
 */
export function meetPeople(
  memory: MemoryState,
  people: Readonly<PeopleState>,
  messages: readonly BatchMessage[],
  now: number,
) {
  for (const subject of memory.subjects) {
    const name = subject.person && people.names[subject.person]
    if (name && subject.name !== clipText(name, LIMITS.name)) {
      subject.name = clipText(name, LIMITS.name)
    }
  }
  for (const author of messages.flatMap((message) => [
    message.author,
    ...message.shown.map((shown) => shown.author),
  ])) {
    if (!memory.subjects.some((subject) => subject.person === author.id)) {
      memory.subjects.push({
        id: `s${memory.next.subject++}`,
        kind: 'person',
        name: clipText(author.name, LIMITS.name),
        person: author.id,
        line: '',
        changed: now,
        profiled: now,
      })
    }
  }
}

/** The subjects a batch's words name, and its authors'. */
export function touched(
  memory: MemoryState,
  messages: readonly BatchMessage[],
) {
  const said = messages.flatMap((message) => [message, ...message.shown])
  const text = ` ${normalized(said.map((each) => each.text).join(' '))} `
  const authors = new Set(said.map((each) => each.author.id))
  return memory.subjects
    .filter(
      (subject) =>
        (subject.person && authors.has(subject.person)) ||
        text.includes(` ${normalized(subject.name)} `),
    )
    .map((subject) => subject.id)
}

const indent = (text: string, by: string) => text.replace(/^/gm, by)

/** A subject on the roster. */
const rosterLine = (subject: Subject) =>
  `${subject.id} ${subject.name} (${subject.person ? 'takes part' : subject.kind})${subject.line ? `: ${subject.line}` : ''}`

/** The input filing's call is given. */
export function renderBatch(
  { lines }: Pick<Selected, 'lines'>,
  memory: MemoryState,
  pages: ReadonlyMap<string, Readonly<PageState>>,
  {
    rooms,
    schedules,
    name,
    timeZone,
  }: {
    rooms: Readonly<RoomRegistry>
    /** What the Familiar keeps itself, so filing leaves it alone. */
    schedules: Readonly<SchedulesState>
    name: string
    timeZone: string
  },
) {
  const said = lines.map((line) => {
    if ('context' in line) {
      return `(${name}: ${line.label}, context only) ${line.context}`
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
                `      [${shown.author.name}]: ${indent(shown.text, '        ').trimStart()}`,
            ),
          ]
        : []),
    ].join('\n')
  })

  const kept = Object.values(schedules)
    .sort((a, b) => a.created - b.created)
    .map(
      ({ id, repeat, at, prompt }) =>
        `${id}, ${repeat === undefined ? `once at ${weekdayMinute(at!, timeZone)}` : `repeating ${repeat}`}: ${clipText(prompt, SCHEDULE_SHOWN)}`,
    )

  const roster: string[] = []
  let size = 0
  for (const subject of [...memory.subjects].sort(
    (a, b) =>
      Number(pages.has(b.id)) - Number(pages.has(a.id)) ||
      b.changed - a.changed,
  )) {
    const line = rosterLine(subject)
    size += line.length + 1
    if (size > FILING_ROSTER) {
      break
    }
    roster.push(line)
  }

  const shownPages = memory.subjects.flatMap((subject) => {
    const page = pages.get(subject.id)
    return page
      ? [
          [
            `${subject.id} ${subject.name}`,
            ...page.notes.map(
              (note) =>
                `  ${note.id} (since ${note.since}, said by ${note.saidBy.name}): ${note.text}`,
            ),
          ].join('\n'),
        ]
      : []
  })

  return [
    'Messages, oldest first:',
    said.join('\n'),
    '',
    `${name}'s schedules, which it keeps and runs itself:`,
    kept.length ? kept.join('\n') : '(none)',
    '',
    'Roster:',
    roster.length ? roster.join('\n') : '(nobody yet)',
    '',
    'Pages these messages touch:',
    shownPages.length ? shownPages.join('\n\n') : '(none)',
  ].join('\n')
}
