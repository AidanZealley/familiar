import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import type { RoomRegistry } from '../rooms/rooms.ts'
import { localDay, localMinute } from '../time.ts'
import { datesIn, type DateRange } from './dates.ts'
import { placeOf } from './filing/batch.ts'
import { TERMS } from './search.ts'
import {
  isCurrent,
  STANDING_TEXT,
  standingOf,
  type JournalLine,
} from './store.ts'
import type { Hit, MemoryView } from './view.ts'

/**
 * Recall: what search finds, as the model is shown it. Automatic recall
 * appends it after the latest message; the `recall` tool returns it. Each
 * item is evidence with its date, who said it and where, and for notes
 * whether it is first-hand and how well supported, in time order.
 */

/** The first line of automatic recall's note, which follows the latest message. */
export const RECALL_HEADING =
  'Recalled from memory for the latest message, oldest first; use it only if relevant:'

/** Automatic recall shows at most this many items, within about this many tokens. */
export const RECALL_LIMIT = 8
export const RECALL_TOKENS = 1_000

/** The `recall` tool shows at most this many items a call, within about this many tokens. */
export const RECALL_TOOL = { limit: 10, tokens: 3_000 }

/** About this many characters of an exchange are shown around its best match. */
const EXCERPT = 300

/**
 * Around the first word of `query` that `text` contains, so a long exchange
 * shows the part that matched.
 */
export function excerpt(text: string, query: string, length = EXCERPT) {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= length) {
    return flat
  }
  const lower = flat.toLowerCase()
  const at = Math.min(
    ...query
      .split(/[^\p{L}\p{N}]+/u)
      .map((word) => TERMS.processTerm(word))
      .flatMap((term) => (term ? [lower.indexOf(term)] : []))
      .filter((index) => index !== -1),
    flat.length,
  )
  const start = at === flat.length ? 0 : Math.max(0, at - length / 3)
  const end = Math.min(flat.length, start + length)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}

const describeLine = (line: JournalLine) => `on ${line.on}: ${line.text}`

/** One item of evidence, as the model reads it. */
export function describeHit(
  hit: Hit,
  query: string,
  rooms: Readonly<RoomRegistry>,
  timeZone: string,
) {
  if (hit.kind === 'exchange') {
    const { exchange, lines } = hit
    const who = exchange.author ? `${exchange.author.name} in ` : ''
    return [
      `${exchange.id}, ${localMinute(exchange.at, timeZone)}, ${who}${placeOf(rooms, exchange.room)}: ${excerpt(exchange.text, query)}`,
      ...lines.map((line) => `  Journal ${describeLine(line)}`),
    ].join('\n')
  }
  const { note, subject } = hit
  const firstHand =
    subject.participant?.kind === 'person' &&
    subject.participant.id === note.saidBy.id
  const said = firstHand
    ? `first-hand from ${note.saidBy.name}`
    : `said by ${note.saidBy.name}`
  const days = note.until
    ? `${note.since} to ${note.until}`
    : `since ${note.since}`
  const state = isCurrent(note)
    ? STANDING_TEXT[standingOf(note)]
    : `no longer current (${note.retired!.reason}${'by' in note.retired! ? ` by ${note.retired!.by}` : ''})`
  return `${note.id}, about ${subject.name} (${subject.id}), ${days}, ${said} in ${placeOf(rooms, note.room)}, ${state}: ${note.text}`
}

/** The day an item is about, for putting evidence in time order. */
const dayOf = (hit: Hit, timeZone: string) =>
  hit.kind === 'exchange' ? localDay(hit.exchange.at, timeZone) : hit.note.since

const orderOf = (hit: Hit) => (hit.kind === 'exchange' ? hit.exchange.at : 0)

/**
 * As many of `hits`, best first, as fit in `tokens`, at most `limit`, then
 * put in time order.
 */
function within(
  hits: readonly Hit[],
  query: string,
  rooms: Readonly<RoomRegistry>,
  timeZone: string,
  { limit, tokens }: { limit: number; tokens: number },
) {
  const kept: { hit: Hit; text: string }[] = []
  let left = tokens
  for (const hit of hits) {
    if (kept.length === limit) {
      break
    }
    const text = describeHit(hit, query, rooms, timeZone)
    const size = estimateTextTokens(text)
    // Stops at the first that doesn't fit, so a next page starts after the last shown.
    if (size > left) {
      break
    }
    kept.push({ hit, text })
    left -= size
  }
  return kept.sort(
    (a, b) =>
      dayOf(a.hit, timeZone).localeCompare(dayOf(b.hit, timeZone)) ||
      orderOf(a.hit) - orderOf(b.hit),
  )
}

/**
 * Automatic recall's note for the latest message, or null when nothing
 * matched: current notes, and exchanges compaction took out of the model's
 * view. Days the message names come first.
 */
export function recallNote(
  view: MemoryView,
  query: string,
  now: number,
  rooms: Readonly<RoomRegistry>,
  timeZone: string,
) {
  const before = view.viewStart
  const { hits } = view.search(query, {
    now,
    limit: RECALL_LIMIT * 2,
    current: true,
    // Without a compaction the whole chat is in view: only notes can add anything.
    ...(before === undefined ? { kind: 'note' as const } : { before }),
    ranges: datesIn(query, localDay(now, timeZone)),
    dates: 'prefer',
  })
  const kept = within(hits, query, rooms, timeZone, {
    limit: RECALL_LIMIT,
    tokens: RECALL_TOKENS,
  })
  return kept.length
    ? `${RECALL_HEADING}\n${kept.map(({ text }) => text).join('\n')}`
    : null
}

export type RecallQuery = {
  query: string
  /** Days, `YYYY-MM-DD`, inclusive. */
  from?: string
  to?: string
  /** A subject's ID, name or alias. */
  about?: string
  offset?: number
}

/** The `recall` tool's answer: one page of matches, how many there are, and whether that is all. */
export function recallAll(
  view: MemoryView,
  { query, from, to, about, offset = 0 }: RecallQuery,
  now: number,
  rooms: Readonly<RoomRegistry>,
  timeZone: string,
) {
  const subject = about?.trim()
    ? (view.subject(about.trim()) ??
      view.subjects().find((each) => view.named(about).includes(each.id)))
    : undefined
  if (about?.trim() && !subject) {
    return `Nobody or nothing called ${about} is in memory. Leave out about to search everything.`
  }
  const range: DateRange | undefined =
    from || to
      ? { start: from || '0000-01-01', end: to || '9999-12-31' }
      : undefined
  const { hits, total } = view.search(query, {
    now,
    limit: RECALL_TOOL.limit,
    offset,
    ...(range && { ranges: [range], dates: 'filter' as const }),
    ...(subject && { about: [subject.id] }),
  })
  const kept = within(hits, query, rooms, timeZone, RECALL_TOOL)
  const scope = [
    range &&
      `from ${range.start === '0000-01-01' ? 'the start' : range.start} to ${range.end === '9999-12-31' ? 'now' : range.end}`,
    subject && `about ${subject.name}`,
  ]
    .filter(Boolean)
    .join(', ')
  const shown = offset + kept.length
  const complete = shown >= total
  return [
    `${total} match${total === 1 ? '' : 'es'}${scope ? ` ${scope}` : ''}. ${
      total === 0
        ? 'Nothing found.'
        : `Showing ${offset + 1}–${shown}, in time order${complete ? '; that is all of them.' : `; not complete: recall again with offset ${shown} for more, or narrow it with from, to or about.`}`
    }`,
    ...kept.map(({ text }) => text),
  ].join('\n')
}
