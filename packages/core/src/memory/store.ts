import { defineDocFamily, type EntryId } from '@earendil-works/pi-durable'
import type { Author } from '../conversation/message.ts'
import type { RoomId } from '../rooms/rooms.ts'
import { formatDay, parseDay } from '../time.ts'
import type { FamiliarId } from '../workspace/familiars.ts'

/**
 * What a Familiar keeps beyond its transcript, which stays the ground truth:
 *
 * - **Pages:** one document per subject (a person or a topic) holding its
 *   notes, what is true of it now, and a profile written from them.
 * - **Journal:** one document per month of dated lines, each a search key
 *   for the exchange it came from.
 * - **The memory index:** the list of subjects and journal months.
 *
 * Search is a view of all of it plus the transcript (view.ts) and owns nothing.
 */

/** Limits, in characters. */
export const LIMITS = {
  note: 300,
  quote: 400,
  profile: 800,
  roster: 2_000,
  line: 200,
  subjectLine: 120,
  name: 80,
} as const

export type Subject = {
  /** `s1`, `s2`, …: never reused. */
  id: string
  kind: 'person' | 'topic'
  name: string
  /** The workspace person this is, when they take part themselves. */
  person?: string
  /** One line for the roster: "Maya's partner", "the house move". */
  line: string
  /** When its notes last changed, in ms. */
  changed: number
  /** The `changed` its profile was written from: due again once they differ. */
  profiled: number
}

export type MemoryState = {
  subjects: Subject[]
  next: { subject: number; note: number }
  /** Months with journal lines, `YYYY-MM`, oldest first. */
  months: string[]
}

/** A Familiar's subjects and journal months. Streamed to clients as `memory`. */
export const Memory = defineDocFamily<MemoryState, null>({
  kind: 'familiar.memory',
  version: 1,
  scope: 'session',
  family: true,
  initial: () => ({ subjects: [], next: { subject: 1, note: 1 }, months: [] }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 50,
})

export type Note = {
  /** `n1`, `n2`, …: unique across the Familiar's pages. */
  id: string
  /** One statement about the subject. */
  text: string
  /** When it became true, `YYYY-MM-DD`. */
  since: string
  /** Words from its source message, checked by code. */
  quote: string
  /** The person message it rests on. */
  source: EntryId
  /** Who said it and where, read from the source, never from the model. */
  saidBy: Author
  room?: RoomId
}

export type PageState = {
  /** Written from the notes after each night's filing. */
  profile: string
  notes: Note[]
}

/** A subject's page. */
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
  /** The day it happened, `YYYY-MM-DD`. */
  on: string
  text: string
  quote: string
  saidBy: Author
  room?: RoomId
}

export type JournalState = { lines: JournalLine[] }

/** One month of journal lines, by the month of the messages they came from. */
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

export const readKey = (key: string) => {
  const at = key.indexOf(':')
  return {
    familiar: Number(key.slice(0, at)) as FamiliarId,
    own: key.slice(at + 1),
  }
}

/** A real calendar day, `YYYY-MM-DD`, or undefined. */
export const dayOrUndefined = (value: unknown) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  formatDay(parseDay(value)) === value
    ? value
    : undefined

/** `text` on one line, at most `limit` characters, cut at a word where it can be. */
export function clipText(text: string, limit: number) {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= limit) {
    return flat
  }
  const cut = flat.slice(0, limit - 1)
  const space = cut.lastIndexOf(' ')
  return `${space > limit / 2 ? cut.slice(0, space) : cut}…`
}

/** Text as quotes are compared: ignoring case, spacing and punctuation. */
export const normalized = (text: string) =>
  text
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim()
