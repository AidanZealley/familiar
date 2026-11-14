import { Type } from '@earendil-works/pi-ai'
import { defineTool, type ToolExecutionApi } from '@earendil-works/pi-durable'
import type { Context } from '@earendil-works/chord'
import { Rooms, type RoomRegistry } from '../rooms/rooms.ts'
import { localMinute } from '../time.ts'
import { familiarFor } from '../workspace/familiars.ts'
import { exchangeId, placeOf, type Exchange } from './exchanges.ts'
import { clipText } from './store.ts'
import { describeHit, recallText } from './recall.ts'
import type { MemoryView, ViewOf } from './view.ts'

/** How much of an exchange `read_memory` shows, and of those either side. */
const SHOWN = { exchange: 6_000, beside: 1_500 }

const showExchange = (
  view: MemoryView,
  exchange: Exchange,
  length: number,
  rooms: Readonly<RoomRegistry>,
  timeZone: string,
) =>
  [
    `${exchange.id} (${localMinute(exchange.at, timeZone)}, ${exchange.author ? `${exchange.author.name} in ` : ''}${placeOf(rooms, exchange.room)}):`,
    exchange.text.length > length
      ? `${exchange.text.slice(0, length)}…`
      : exchange.text,
    ...view
      .linesOf(exchange.id)
      .map((line) => `Journal, on ${line.on}: ${line.text}`),
  ].join('\n')

/** What lies behind a subject, note or exchange ID. */
export function readMemory(
  view: MemoryView,
  id: string,
  rooms: Readonly<RoomRegistry>,
  timeZone: string,
) {
  const subject = view.subject(id)
  if (subject) {
    const page = view.page(id)
    return [
      `${subject.id} ${subject.name}${subject.line ? `: ${subject.line}` : ''}`,
      `Profile: ${page?.profile || '(none yet)'}`,
      ...(page?.notes ?? []).map(
        (note) =>
          `${describeHit({ kind: 'note', note, subject }, '', rooms, timeZone)}\n  Rests on: "${note.quote}"`,
      ),
    ].join('\n')
  }
  const note = view.note(id)
  const around = view.around(note ? exchangeId(note.note.source) : id)
  if (note) {
    return [
      describeHit(note, '', rooms, timeZone),
      `Rests on: "${note.note.quote}"`,
      around
        ? `From:\n${showExchange(view, around.exchange, SHOWN.exchange, rooms, timeZone)}`
        : 'Its message is not searchable yet.',
    ].join('\n')
  }
  if (around) {
    const { before, exchange, after } = around
    return [
      before &&
        `Before:\n${showExchange(view, before, SHOWN.beside, rooms, timeZone)}`,
      showExchange(view, exchange, SHOWN.exchange, rooms, timeZone),
      after &&
        `After:\n${showExchange(view, after, SHOWN.beside, rooms, timeZone)}`,
    ]
      .filter(Boolean)
      .join('\n\n')
  }
  return `Nothing has the ID ${id}. Subjects start with s, notes with n and conversations with x; the latest message isn't searchable yet, but you can already see it.`
}

const text = (text: string) => ({
  output: [{ type: 'text' as const, text }],
})

/** The chat's memory tools; both catch the view up with the transcript first. */
export function createMemoryTools(viewOf: ViewOf, timeZone: string) {
  const read = async (
    api: ToolExecutionApi,
    context: Context,
    answer: (view: MemoryView, rooms: Readonly<RoomRegistry>) => string,
  ) => {
    const familiar = await api.commit(
      (tx) => familiarFor(tx, api.conversationId),
      context,
    )
    const view = viewOf(familiar)
    await view.ready()
    return api
      .commit(async (tx) => {
        await view.catchUp(tx)
        return answer(view, await tx.doc(Rooms))
      }, context)
      .then(text)
  }

  const recall = defineTool({
    name: 'recall',
    description:
      "Search everything you've been told beyond what you always see: notes about people and things, and the conversations themselves, with the dated journal lines that make them findable. from and to keep only what happened on those days. read_memory opens any result.",
    parameters: Type.Object({
      query: Type.String({
        description: 'Words to search for; empty to list what is in from–to.',
      }),
      from: Type.Optional(
        Type.String({ description: 'First day, YYYY-MM-DD.' }),
      ),
      to: Type.Optional(Type.String({ description: 'Last day, YYYY-MM-DD.' })),
    }),
    execute: (args, api, context) =>
      read(api, context, (view, rooms) =>
        recallText(view, args, api.now(), rooms, timeZone),
      ),
  })

  const readMemoryTool = defineTool({
    name: 'read_memory',
    description:
      'Open what lies behind an ID: a person or thing (s…), with its profile and notes; a note (n…), with the message it rests on; or a conversation (x…), with the ones either side.',
    parameters: Type.Object({ id: Type.String() }),
    execute: (args, api, context) =>
      read(api, context, (view, rooms) =>
        readMemory(view, clipText(args.id, 40), rooms, timeZone),
      ),
  })

  return [recall, readMemoryTool]
}
