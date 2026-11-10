import type { ConversationView, EntryRecord } from '@earendil-works/pi-durable'
import type { RoomActivity } from '@familiar-ai/core/http'
import { expect, test } from 'vitest'
import { carryOver, type History } from './log.ts'
import { composeMessage } from './mentions.ts'
import {
  HANDOFF_KIND,
  MESSAGE_KIND,
  REPLY_KIND,
  toRoomTranscript,
} from './transcript.ts'

// Entries as a room log commits them: IDs ascend in commit order.
const entry = (id: number, kind: string, data: object) =>
  ({ id, conversationId: 1, kind, data }) as unknown as EntryRecord

const aidan = { id: 'aidan', name: 'Aidan' }

const said = (id: number, text: string, author = aidan) =>
  entry(id, MESSAGE_KIND, { author, text, at: id * 1000 })

const text = (text: string) => ({ type: 'text', text })

const assistant = (content: object[], stopReason = 'stop', timestamp = 1) => ({
  role: 'assistant',
  content,
  stopReason,
  timestamp,
})

const toolResult = (toolCallId: string, output: string) => ({
  role: 'toolResult',
  toolCallId,
  content: [text(output)],
  isError: false,
})

const clock = { type: 'toolCall', id: 'c1', name: 'clock', arguments: {} }

const replied = (
  id: number,
  cause: number,
  messages: object[],
  outcome = 'answered',
) =>
  entry(id, REPLY_KIND, { familiar: 3, name: 'Ada', cause, outcome, messages })

const viewOf = (...entries: EntryRecord[]) =>
  ({ conversation: {}, entries, docs: {} }) as unknown as ConversationView

test("people's messages and copied replies render in order, with each reply's tool calls settled", () => {
  const view = viewOf(
    said(2, 'What time is it?'),
    replied(3, 2, [
      assistant([text('Checking.'), clock]),
      toolResult('c1', '12:00'),
      assistant([text('Noon.')]),
    ]),
  )
  const { items, busy } = toRoomTranscript(view, [said(1, 'Hello')])
  expect(busy).toBe(false)
  expect(items).toEqual([
    expect.objectContaining({ type: 'message', text: 'Hello', at: 1000 }),
    expect.objectContaining({ type: 'message', text: 'What time is it?' }),
    expect.objectContaining({
      type: 'reply',
      id: 'entry:3:0',
      familiar: 3,
      name: 'Ada',
      text: 'Checking.',
      toolCalls: [expect.objectContaining({ status: 'done', output: '12:00' })],
      streaming: false,
    }),
    expect.objectContaining({ type: 'reply', id: 'entry:3:2', text: 'Noon.' }),
  ])

  // A stopped reply says so; a failed one with nothing said still shows it failed.
  const stopped = toRoomTranscript(
    viewOf(
      replied(4, 2, [assistant([text('Half')], 'aborted')], 'stopped'),
      replied(5, 2, [], 'failed'),
    ),
  ).items
  expect(stopped).toMatchObject([
    { type: 'reply', text: 'Half', stopped: true },
    { type: 'reply', error: 'The reply failed.' },
  ])
})

test('a handoff shows who asked whom, and a quiet reply says it passed', () => {
  const quiet = {
    type: 'toolCall',
    id: 'q1',
    name: 'stay_quiet',
    arguments: {},
  }
  const { items } = toRoomTranscript(
    viewOf(
      said(1, 'Paint?'),
      entry(2, HANDOFF_KIND, {
        from: 3,
        to: 4,
        note: 'Which paint?',
        hops: 1,
        cause: 1,
        at: 2000,
      }),
      replied(
        3,
        2,
        [assistant([quiet], 'toolUse'), toolResult('q1', 'You stayed quiet.')],
        'quiet',
      ),
    ),
  )
  expect(items.slice(1)).toEqual([
    {
      type: 'handoff',
      id: 'entry:2',
      from: 3,
      to: 4,
      note: 'Which paint?',
      at: 2000,
    },
    expect.objectContaining({
      type: 'reply',
      text: '',
      quiet: true,
      toolCalls: [
        expect.objectContaining({ name: 'stay_quiet', status: 'done' }),
      ],
    }),
  ])
})

test('each turn in progress shows what it waits for, then its reply as it streams', () => {
  const view = viewOf(said(1, 'Hello'))
  const items = (turns: RoomActivity) =>
    toRoomTranscript(view, [], turns).items.slice(1)

  expect(
    items({
      7: { familiar: 3, cause: 1, status: 'queued' },
      8: { familiar: 4, cause: 1, status: 'elsewhere' },
    } as unknown as RoomActivity),
  ).toEqual([
    { type: 'waiting', id: 'turn:7', familiar: 3, status: 'queued' },
    { type: 'waiting', id: 'turn:8', familiar: 4, status: 'elsewhere' },
  ])
  // Running, before anything shows.
  expect(
    items({ 7: { familiar: 3, cause: 1, status: 'running' } } as never),
  ).toEqual([{ type: 'waiting', id: 'turn:7', familiar: 3, status: 'running' }])

  // The reply so far keeps the turn's ID, as does a later round's tools.
  const streaming = items({
    7: {
      familiar: 3,
      cause: 1,
      status: 'running',
      generation: {
        attempt: 0,
        message: assistant([{ type: 'thinking', thinking: 'Hmm' }, clock]),
      },
      tools: [{ callId: 'c1', name: 'clock', status: 'running', output: '1' }],
    },
  } as unknown as RoomActivity)
  expect(streaming).toEqual([
    expect.objectContaining({
      type: 'reply',
      id: 'turn:7',
      thinking: 'Hmm',
      streaming: true,
      toolCalls: [
        expect.objectContaining({
          name: 'clock',
          status: 'running',
          output: '1',
        }),
      ],
    }),
  ])
  const tooling = items({
    7: {
      familiar: 3,
      cause: 1,
      status: 'running',
      tools: [{ callId: 'c2', name: 'search', status: 'done', output: 'x' }],
    },
  } as unknown as RoomActivity)
  expect(tooling).toEqual([
    expect.objectContaining({
      id: 'turn:7',
      streaming: true,
      toolCalls: [
        {
          id: 'c2',
          name: 'search',
          arguments: {},
          status: 'done',
          output: 'x',
        },
      ],
    }),
  ])
  expect(toRoomTranscript(view, [], { 7: {} } as never).busy).toBe(true)
})

test('a message keeps the mentions its author picked', () => {
  const { text, mentions } = composeMessage([
    'Thanks ',
    { kind: 'familiar', id: 3, name: 'Ada' },
    ' and ',
    { kind: 'person', id: 'bo', name: 'Bo' },
    '!',
  ])
  expect(text).toBe('Thanks @Ada and @Bo!')
  expect(mentions).toEqual([
    { kind: 'familiar', id: '3', start: 7, end: 11 },
    { kind: 'person', id: 'bo', start: 16, end: 19 },
  ])
  expect(mentions.map(({ start, end }) => text.slice(start, end))).toEqual([
    '@Ada',
    '@Bo',
  ])

  const view = viewOf(
    entry(1, MESSAGE_KIND, { author: aidan, text, at: 1, mentions }),
  )
  expect(toRoomTranscript(view).items[0]).toMatchObject({ mentions })
})

test('history starts over when a new view leaves a gap, and is kept when it starts in place', () => {
  const history = [said(1, 'one'), said(2, 'two')]
  const loaded: History = { entries: history, status: 'start' }
  const view = viewOf(said(3, 'three'))
  expect(carryOver(loaded, view, viewOf(said(20, 'much later')))).toEqual({
    entries: [],
    status: 'more',
  })
  expect(carryOver(loaded, view, view)).toBe(loaded)
})
