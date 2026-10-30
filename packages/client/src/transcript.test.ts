import { MESSAGE_KIND } from './conversation/message.ts'
import type { ConversationView, EntryRecord } from '@earendil-works/pi-durable'
import { expect, test } from 'vitest'
import { carryOver, startOf, type History } from './store.ts'
import { toTranscript } from './transcript.ts'

// Entries as storage commits them: IDs ascend in commit order.
const entry = (id: number, kind: string, rest: object = {}) =>
  ({ id, conversationId: 1, kind, ...rest }) as unknown as EntryRecord

const said = (id: number, text: string) =>
  entry(id, MESSAGE_KIND, { data: { author: 'aidan', text } })

const replied = (id: number, content: object[], stopReason: string = 'stop') =>
  entry(id, 'pi.assistant', {
    model: [{ role: 'assistant', content, stopReason }],
  })

const text = (text: string) => ({ type: 'text', text })

const toolResult = (id: number, toolCallId: string, output: string) =>
  entry(id, 'pi.tool-result', {
    model: [
      {
        role: 'toolResult',
        toolCallId,
        content: [text(output)],
        isError: false,
      },
    ],
  })

const compaction = (id: number, head: number) =>
  entry(id, 'pi.compaction', { head })

const viewOf = (...entries: EntryRecord[]) =>
  ({ conversation: {}, entries, docs: {} }) as unknown as ConversationView

/** Each item as a short label, to compare order at a glance. */
const labels = (view: ConversationView, history?: EntryRecord[]) =>
  toTranscript(view, history).items.map((item) =>
    item.type === 'waiting'
      ? 'thinking'
      : item.type === 'compaction'
        ? '---'
        : item.type === 'message'
          ? `> ${item.text}`
          : item.type === 'scheduled'
            ? `(scheduled) ${item.prompt}`
            : item.text || item.toolCalls.map((call) => call.name).join(),
  )

// Two compactions: the first summarised 1-2 and kept from 3, the second
// summarised up to 6 and kept from 7, partway through a tool round.
const history = [
  said(1, 'one'),
  replied(2, [text('reply one')]),
  said(3, 'two'),
  replied(4, [text('reply two')]),
  compaction(5, 3),
  said(6, 'three'),
  replied(7, [{ type: 'toolCall', id: 'c1', name: 'clock', arguments: {} }]),
]
const view = viewOf(
  compaction(10, 8),
  toolResult(8, 'c1', '12:00'),
  replied(9, [text('reply three')]),
)

test('history renders before the view, with compactions where they summarised', () => {
  expect(labels(view)).toEqual(['---', 'reply three'])
  expect(labels(view, history)).toEqual([
    '> one',
    'reply one',
    '---',
    '> two',
    'reply two',
    '> three',
    'clock',
    '---',
    'reply three',
  ])
})

test('a tool call in history pairs with its result in the view', () => {
  const reply = toTranscript(view, history).items.find(
    (item) => item.type === 'reply' && item.toolCalls.length,
  )
  expect(reply).toMatchObject({
    toolCalls: [{ id: 'c1', status: 'done', output: '12:00' }],
  })
})

test('item IDs are unique across history and view', () => {
  const ids = toTranscript(view, history).items.map((item) => item.id)
  expect(new Set(ids).size).toBe(ids.length)
})

test('a stopped reply is marked', () => {
  const [reply] = toTranscript(
    viewOf(replied(1, [text('Part one')], 'aborted')),
  ).items
  expect(reply).toMatchObject({ type: 'reply', stopped: true })
})

test('a reply keeps its identity from streaming through completion or stopping', () => {
  const message = {
    role: 'assistant',
    content: [text('Part one')],
    timestamp: 1234,
    stopReason: 'stop',
  }
  const live: ConversationView = {
    ...viewOf(said(1, 'hello')),
    docs: {
      'pi.live': {
        run: { taskId: 7, inputs: [] },
        generation: { attempt: 0, message },
      },
    },
  }
  const streaming = toTranscript(live).items.at(-1)!
  expect(streaming).toMatchObject({ type: 'reply', streaming: true })

  for (const stopReason of ['stop', 'aborted', 'error']) {
    const saved = entry(2, 'pi.assistant', {
      byTaskId: 7,
      model: [{ ...message, stopReason }],
    })
    const completed = toTranscript(viewOf(said(1, 'hello'), saved)).items.at(
      -1,
    )!
    expect(completed).toMatchObject({ id: streaming.id, streaming: false })
    expect(
      toTranscript(viewOf(saved), [said(1, 'hello')]).items.at(-1)?.id,
    ).toBe(streaming.id)
  }

  // A retry belongs to the same task, but is a separate reply.
  const failedAttempt = entry(2, 'pi.assistant', {
    byTaskId: 7,
    model: [{ ...message, timestamp: 1233, stopReason: 'error' }],
  })
  const retrying = {
    ...viewOf(said(1, 'hello'), failedAttempt),
    docs: live.docs,
  }
  const replies = toTranscript(retrying).items.filter(
    (item) => item.type === 'reply',
  )
  expect(replies).toHaveLength(2)
  expect(replies[0]!.id).not.toBe(replies[1]!.id)
  expect(replies[1]!.id).toBe(streaming.id)
})

test('a view starts at the entry its head marker heads', () => {
  expect(startOf(view)).toBe(8)
  expect(startOf(viewOf(said(4, 'hi'), said(5, 'there')))).toBe(4)
})

test('what compaction takes out of the view joins history', () => {
  const before = viewOf(
    compaction(10, 8),
    toolResult(8, 'c1', '12:00'),
    replied(9, [text('reply three')]),
    said(11, 'four'),
    replied(12, [text('reply four')]),
  )
  const after = viewOf(
    compaction(13, 11),
    said(11, 'four'),
    replied(12, [text('reply four')]),
  )
  const loaded: History = { entries: history, status: 'more' }
  const carried = carryOver(loaded, before, after)
  expect(carried.entries.map((entry) => entry.id)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  ])
  expect(labels(after, [...carried.entries])).toEqual([
    '> one',
    'reply one',
    '---',
    '> two',
    'reply two',
    '> three',
    'clock',
    '---',
    'reply three',
    '---',
    '> four',
    'reply four',
  ])
})

test('history starts over when the new view leaves a gap', () => {
  const loaded: History = { entries: history, status: 'start' }
  const later = viewOf(compaction(30, 20), said(20, 'much later'))
  expect(carryOver(loaded, view, later)).toEqual({
    entries: [],
    status: 'more',
  })
  // Unchanged when the view's start stays put.
  expect(carryOver(loaded, view, view)).toBe(loaded)
})

test('waiting feedback covers the first token and the gap after a completed tool', () => {
  const live = (state: object) =>
    ({
      ...viewOf(said(1, 'hello')),
      docs: { 'pi.live': state },
    }) as ConversationView
  const run = { taskId: 7, inputs: [] }
  const waiting = { type: 'waiting', id: 'waiting:7' }
  expect(toTranscript(live({ run })).items.at(-1)).toEqual(waiting)
  expect(
    toTranscript(live({ run, tools: [{ status: 'done' }] })).items.at(-1),
  ).toEqual(waiting)
  expect(
    toTranscript(live({ run, tools: [{ status: 'running' }] })).items,
  ).not.toContainEqual(waiting)
  expect(toTranscript(live({})).items).not.toContainEqual(waiting)

  for (const content of [
    [],
    [text('Answer')],
    [{ type: 'thinking', thinking: 'Shared reasoning' }],
  ]) {
    const transcript = toTranscript(
      live({
        run,
        generation: {
          attempt: 0,
          message: {
            role: 'assistant',
            content,
            timestamp: 1234,
            stopReason: 'stop',
          },
        },
      }),
    )
    expect(transcript.items).not.toContainEqual(waiting)
    expect(transcript.items.at(-1)).toMatchObject({
      type: 'reply',
      streaming: true,
    })
  }
})

test('reasoning remains available to expand after the reply completes', () => {
  expect(
    toTranscript(
      viewOf(
        replied(1, [
          { type: 'thinking', thinking: 'Provider supplied reasoning' },
          text('Answer'),
        ]),
      ),
    ).items.at(-1),
  ).toMatchObject({
    type: 'reply',
    thinking: 'Provider supplied reasoning',
    text: 'Answer',
    streaming: false,
  })
})
