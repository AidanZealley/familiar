import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import type { RoomRegistry } from '../rooms/rooms.ts'
import { localDay, localMinute } from '../time.ts'
import { datesIn, type DateRange } from './dates.ts'
import { placeOf } from './exchanges.ts'
import { TERMS } from './search.ts'
import type { Hit, MemoryView } from './view.ts'

/**
 * What search finds, as the model is shown it: evidence with its date, who
 * said it and where, in time order. Automatic recall appends it after the
 * latest message; the `recall` tool returns it.
 */

/** The first line of automatic recall's note, which follows the latest message. */
export const RECALL_HEADING =
  'Recalled from memory for the latest message, oldest first; use it only if relevant:'

/** How much each shows: automatic recall, and the `recall` tool. */
export const RECALL = { limit: 8, tokens: 1_000 }
export const RECALL_TOOL = { limit: 10, tokens: 3_000 }

/** About this many characters of an exchange are shown around its first match. */
const EXCERPT = 300

/** Around the first word of `query` that `text` contains. */
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
      ...lines.map((line) => `  Journal, on ${line.on}: ${line.text}`),
    ].join('\n')
  }
  const { note, subject } = hit
  const said =
    subject.person === note.saidBy.id
      ? `first-hand from ${note.saidBy.name}`
      : `said by ${note.saidBy.name}`
  return `${note.id}, about ${subject.name} (${subject.id}), since ${note.since}, ${said} in ${placeOf(rooms, note.room)}: ${note.text}`
}

const dayOf = (hit: Hit, timeZone: string) =>
  hit.kind === 'exchange' ? localDay(hit.exchange.at, timeZone) : hit.note.since

/** As many of `hits`, best first, as fit in `tokens`, then put in time order. */
function within(
  hits: readonly Hit[],
  query: string,
  rooms: Readonly<RoomRegistry>,
  timeZone: string,
  tokens: number,
) {
  const kept: { hit: Hit; text: string }[] = []
  let left = tokens
  for (const hit of hits) {
    const text = describeHit(hit, query, rooms, timeZone)
    left -= estimateTextTokens(text)
    if (left < 0) {
      break
    }
    kept.push({ hit, text })
  }
  return kept
    .sort(
      (a, b) =>
        dayOf(a.hit, timeZone).localeCompare(dayOf(b.hit, timeZone)) ||
        (a.hit.kind === 'exchange' ? a.hit.exchange.at : 0) -
          (b.hit.kind === 'exchange' ? b.hit.exchange.at : 0),
    )
    .map(({ text }) => text)
}

/**
 * Automatic recall's note for the latest message, or null when nothing
 * matched: notes, and exchanges compaction took out of the model's view,
 * on the days the message names if it names any.
 */
export function recallNote(
  view: MemoryView,
  query: string,
  now: number,
  rooms: Readonly<RoomRegistry>,
  timeZone: string,
) {
  const before = view.viewStart()
  const hits = view.search(query, {
    now,
    limit: RECALL.limit,
    // Without a compaction the whole chat is in view: only notes can add anything.
    ...(before === undefined ? { kind: 'note' as const } : { before }),
    ranges: datesIn(query, localDay(now, timeZone)),
  })
  const kept = within(hits, query, rooms, timeZone, RECALL.tokens)
  return kept.length ? `${RECALL_HEADING}\n${kept.join('\n')}` : null
}

/** The `recall` tool's answer: the best matches, within `from` to `to` if given. */
export function recallText(
  view: MemoryView,
  { query, from, to }: { query: string; from?: string; to?: string },
  now: number,
  rooms: Readonly<RoomRegistry>,
  timeZone: string,
) {
  const range: DateRange | undefined =
    from || to
      ? { start: from || '0000-01-01', end: to || '9999-12-31' }
      : undefined
  const hits = view.search(query, {
    now,
    limit: RECALL_TOOL.limit,
    ...(range && { ranges: [range] }),
  })
  const kept = within(hits, query, rooms, timeZone, RECALL_TOOL.tokens)
  return kept.length
    ? `The best matches, in time order:\n${kept.join('\n')}`
    : 'Nothing found.'
}
