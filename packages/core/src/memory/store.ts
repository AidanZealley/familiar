import {
  defineDocFamily,
  type EntryId,
  type Tx,
} from '@earendil-works/pi-durable'
import type { Author } from '../conversation/message.ts'
import type { RoomId } from '../rooms/rooms.ts'
import { formatDay, parseDay } from '../time.ts'
import type { FamiliarId } from '../workspace/familiars.ts'

/**
 * What a Familiar keeps beyond its transcript, and the rules every writer
 * follows. Three stores, one job each:
 *
 * - **Pages:** one document per subject (a person, a topic, the Familiar
 *   itself) holding its notes, what is true of it now, and a profile written
 *   from them by consolidation.
 * - **Journal:** one document per month of dated lines, each the key to the
 *   exchange it came from, so that exchange can be found again.
 * - **The memory index:** the list of subjects, which the roster, the app
 *   and every writer read.
 *
 * The transcript stays the ground truth and is never copied. Search is a
 * view of all of it, rebuilt on demand (see view.ts), so it owns nothing.
 */

/** Limits, in characters, tuned by the evals. */
export const LIMITS = {
  note: 300,
  quote: 400,
  profile: 800,
  roster: 2_000,
  line: 200,
  /** A subject's one-line description on the roster. */
  subjectLine: 120,
  name: 80,
} as const

export type SubjectKind = 'self' | 'person' | 'topic'

/** The workspace person or Familiar a subject is, when they take part themselves. */
export type Participant = { kind: 'person' | 'familiar'; id: string }

export type Subject = {
  /** `s1`, `s2`, …: never reused. */
  id: string
  kind: SubjectKind
  name: string
  /** Other names it goes by: "Mum", "Grace". */
  aliases: string[]
  participant?: Participant
  /** One line for the roster: "Maya's partner", "the house move". */
  line: string
  /** When its page last changed, in ms: the roster's order and consolidation's. */
  changed: number
  /** When consolidation last tidied its page; it is due again once `changed` passes it. */
  tidied?: number
}

export type MemoryState = {
  /** In the order they were made; `s1` is the Familiar's own. */
  subjects: Subject[]
  /** Next subject and note numbers. */
  next: { subject: number; note: number }
  /** Months with journal lines, `YYYY-MM`, oldest first. */
  months: string[]
  /**
   * Person messages someone asked memory to forget something from: filing
   * never writes a note or journal line from them again.
   */
  forgotten: EntryId[]
}

/**
 * A Familiar's table of contents: its subjects, journal months and what it
 * was asked to forget. Streamed to clients as `memory`.
 */
export const Memory = defineDocFamily<MemoryState, null>({
  kind: 'familiar.memory',
  version: 1,
  scope: 'session',
  family: true,
  initial: () => ({
    subjects: [],
    next: { subject: 1, note: 1 },
    months: [],
    forgotten: [],
  }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 50,
})

export type NoteKind = 'fact' | 'preference' | 'plan' | 'lesson'

/** Why a note stopped being current. */
export type Retired =
  | { reason: 'superseded' | 'duplicate'; by: string; at: number }
  | {
      reason: 'contradicted' | 'obsolete' | 'expired' | 'stale' | 'forgotten'
      at: number
    }

export type Note = {
  /** `n1`, `n2`, …: unique across the Familiar's pages, never reused. */
  id: string
  kind: NoteKind
  /** One declarative statement. Empty once forgotten. */
  text: string
  /** Other subjects it names, so search finds it from their side. */
  mentions: string[]
  /** World time, `YYYY-MM-DD`: when it became true, and when it stops or stopped. */
  since: string
  until?: string
  /** Words from one source message, checked by code. Empty once forgotten. */
  quote: string
  /** Person messages it rests on, oldest first. */
  sources: EntryId[]
  /** Who said it and where, read from the source by code, never claimed by the model. */
  saidBy: Author
  room?: RoomId
  /** Someone asked for it to be remembered, or filing inferred it. */
  origin: 'stated' | 'inferred'
  /** When it was written, in ms. */
  saved: number
  /** Absent while current. */
  retired?: Retired
}

export type PageState = {
  /** Written by consolidation from the current notes. */
  profile: string
  /** Current and retired, in the order written. */
  notes: Note[]
}

/** A subject's page: its notes and profile. One document per page. */
export const Pages = defineDocFamily<PageState, null>({
  kind: 'familiar.page',
  version: 1,
  scope: 'session',
  family: true,
  initial: () => ({ profile: '', notes: [] }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 20,
})

export type JournalLine = {
  /** The person message it came from. */
  exchange: EntryId
  /** The day it happened, `YYYY-MM-DD`, resolved from "yesterday" or "last week". */
  on: string
  text: string
  subjects: string[]
  quote: string
  saidBy: Author
  room?: RoomId
}

export type JournalState = { lines: JournalLine[] }

/**
 * One month of journal lines, by the month of the messages they came from.
 * Filing goes through the transcript in order, so a month it has passed is
 * never written again.
 */
export const Journal = defineDocFamily<JournalState, null>({
  kind: 'familiar.journal',
  version: 1,
  scope: 'session',
  family: true,
  initial: () => ({ lines: [] }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 50,
})

/** A page's or journal month's key: its Familiar's ID, then its own. */
export const keyOf = (familiar: FamiliarId, own: string) => `${familiar}:${own}`

/** The Familiar and own key of a page's or month's document key. */
export const readKey = (key: string) => {
  const at = key.indexOf(':')
  return {
    familiar: Number(key.slice(0, at)) as FamiliarId,
    own: key.slice(at + 1),
  }
}

/** The Familiar's own subject: how it has learned to work. */
export const SELF = 's1'

/** A Familiar's memory index, made with its own page's subject on first use. */
export async function memoryOf(tx: Tx, familiar: FamiliarId, name: string) {
  const memory = await tx.doc(Memory, String(familiar), null)
  if (!memory.subjects.length) {
    memory.subjects.push({
      id: SELF,
      kind: 'self',
      name,
      aliases: [],
      line: 'you',
      changed: 0,
      tidied: 0,
    })
    memory.next.subject = 2
  }
  return memory
}

/** A subject's page, for a change: stamps the subject as changed at `now`. */
export async function openPage(
  tx: Tx,
  familiar: FamiliarId,
  memory: MemoryState,
  subject: string,
  now: number,
) {
  const entry = memory.subjects.find((other) => other.id === subject)
  if (!entry) {
    throw new Error(`No subject ${subject}.`)
  }
  entry.changed = now
  return tx.doc(Pages, keyOf(familiar, subject), null)
}

/** A month's journal, for a change: lists the month in the index. */
export async function openMonth(
  tx: Tx,
  familiar: FamiliarId,
  memory: MemoryState,
  month: string,
) {
  if (!memory.months.includes(month)) {
    memory.months.push(month)
    memory.months.sort()
  }
  return tx.doc(Journal, keyOf(familiar, month), null)
}

/** How well a note is supported, worked out when read: never stored. */
export type Standing = 'stated' | 'confirmed' | 'tentative'

export const standingOf = (note: Pick<Note, 'origin' | 'sources'>): Standing =>
  note.origin === 'stated'
    ? 'stated'
    : note.sources.length >= 2
      ? 'confirmed'
      : 'tentative'

/** How the model reads a standing. */
export const STANDING_TEXT: Record<Standing, string> = {
  stated: 'asked to be remembered',
  confirmed: 'repeated',
  tentative: 'said once',
}

export const isCurrent = (note: Note) => note.retired === undefined

/** A real calendar day, `YYYY-MM-DD`, or undefined. */
export const dayOrUndefined = (value: unknown) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  formatDay(parseDay(value)) === value
    ? value
    : undefined

/** `text` trimmed to at most `limit` characters, cut at a word where it can be. */
export function clipText(text: string, limit: number) {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= limit) {
    return flat
  }
  const cut = flat.slice(0, limit - 1)
  const space = cut.lastIndexOf(' ')
  return `${space > limit / 2 ? cut.slice(0, space) : cut}…`
}

/** Text compared as quotes and duplicates are: ignoring case, spacing and quote marks. */
export const normalized = (text: string) =>
  text
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim()

/** The subject with this name or alias, ignoring case. */
export const subjectNamed = (memory: MemoryState, name: string) => {
  const wanted = normalized(name)
  return memory.subjects.find(
    (subject) =>
      normalized(subject.name) === wanted ||
      subject.aliases.some((alias) => normalized(alias) === wanted),
  )
}
