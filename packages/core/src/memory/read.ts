import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import type { RoomRegistry } from '../rooms/rooms.ts'
import { localMinute } from '../time.ts'
import { exchangeId, type Exchange } from './exchanges.ts'
import { describeNote, placeOf } from './filing/batch.ts'
import { describeHit } from './recall.ts'
import { isCurrent } from './store.ts'
import type { MemoryView } from './view.ts'

/**
 * What `read_memory` shows behind an ID: a subject's page, a note with the
 * messages it rests on, or an exchange with the ones either side, so a terse
 * note never makes the conversation behind it unreachable.
 */

/** `read_memory` answers within about this many tokens. */
export const READ_TOKENS = 3_000

/** `text` cut to about `tokens`, marked where it was cut. */
function clip(text: string, tokens: number) {
  const size = estimateTextTokens(text)
  if (size <= tokens) {
    return text
  }
  return `${text.slice(0, Math.max(0, Math.floor((text.length * tokens) / size) - 1))}…`
}

function showExchange(
  view: MemoryView,
  exchange: Exchange,
  tokens: number,
  rooms: Readonly<RoomRegistry>,
  timeZone: string,
) {
  const who = exchange.author ? `${exchange.author.name} in ` : ''
  const lines = view.linesOf(exchange.id)
  return [
    `${exchange.id} (${localMinute(exchange.at, timeZone)}, ${who}${placeOf(rooms, exchange.room)}):`,
    clip(exchange.text, tokens),
    ...lines.map((line) => `Journal, on ${line.on}: ${line.text}`),
  ].join('\n')
}

/** As many `parts` as fit in `tokens`, then a note naming what was left out. */
function upTo(parts: { id: string; text: string }[], tokens: number) {
  const kept: string[] = []
  let left = tokens
  for (const [index, part] of parts.entries()) {
    const size = estimateTextTokens(part.text)
    if (size > left) {
      kept.push(
        `Not shown: ${parts
          .slice(index)
          .map(({ id }) => id)
          .join(', ')}.`,
      )
      break
    }
    kept.push(part.text)
    left -= size
  }
  return kept
}

/** What lies behind a subject, note or exchange ID. */
export function readMemory(
  view: MemoryView,
  id: string,
  rooms: Readonly<RoomRegistry>,
  timeZone: string,
) {
  if (id.startsWith('x')) {
    const found = view.around(id)
    if (!found) {
      return `No exchange ${id}. The latest message isn't searchable yet: you can already see it.`
    }
    const { before, exchange, after } = found
    return [
      before &&
        `Before:\n${showExchange(view, before, READ_TOKENS / 6, rooms, timeZone)}`,
      showExchange(view, exchange, (READ_TOKENS * 2) / 3, rooms, timeZone),
      after &&
        `After:\n${showExchange(view, after, READ_TOKENS / 6, rooms, timeZone)}`,
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  const subject = view.subject(id)
  if (subject) {
    const page = view.page(id)
    const notes = page?.notes ?? []
    const head = [
      `${subject.id} ${subject.name} (${subject.kind}${subject.participant ? ', takes part' : ''})${subject.line ? `: ${subject.line}` : ''}`,
      ...(subject.aliases.length
        ? [`Also called ${subject.aliases.join(', ')}.`]
        : []),
      `Profile: ${page?.profile || '(none yet)'}`,
    ].join('\n')
    const current = notes.filter(isCurrent)
    const past = notes.filter(
      (note) => !isCurrent(note) && note.retired!.reason !== 'forgotten',
    )
    return [
      head,
      current.length ? 'Current notes:' : 'No current notes.',
      ...upTo(
        [
          ...current.map((note) => ({
            id: note.id,
            text: describeNote(note, subject, rooms),
          })),
          ...(past.length
            ? [
                { id: 'past', text: 'No longer current:' },
                ...past.map((note) => ({
                  id: note.id,
                  text: `${note.id} (${note.retired!.reason}${'by' in note.retired! ? ` by ${note.retired!.by}` : ''}): ${note.text}`,
                })),
              ]
            : []),
        ],
        READ_TOKENS - estimateTextTokens(head),
      ),
    ].join('\n')
  }

  const found = view.note(id)
  if (found) {
    const { note } = found
    const head = [
      describeHit(found, '', rooms, timeZone),
      `Rests on: "${note.quote}"`,
    ].join('\n')
    const sources = note.sources.flatMap(
      (entry) => view.around(exchangeId(entry))?.exchange ?? [],
    )
    const left = READ_TOKENS - estimateTextTokens(head)
    return [
      head,
      sources.length ? 'From:' : 'Its messages are not searchable yet.',
      ...upTo(
        sources.map((source) => ({
          id: source.id,
          // Each gets an equal share, so one long message can't hide the rest.
          text: showExchange(
            view,
            source,
            left / sources.length - 20,
            rooms,
            timeZone,
          ),
        })),
        left,
      ),
    ].join('\n')
  }

  return `Nothing has the ID ${id}. Subjects start with s, notes with n and exchanges with x.`
}
