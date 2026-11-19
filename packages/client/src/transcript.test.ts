import type { TranscriptView, EntryRecord } from '@earendil-works/pi-durable'
import type { RoomActivity } from '@familiar-ai/core/http'
import { expect, test } from 'vitest'
import { composeMessage } from './mentions.ts'
import {
  HANDOFF_KIND,
  MESSAGE_KIND,
  NOTE_KIND,
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
  entry(id, REPLY_KIND, {
    familiar: 3,
    name: 'Ada',
    cause,
    outcome,
    messages,
    at: id * 1000,
  })

const viewOf = (...entries: EntryRecord[]) =>
  ({
    conversation: {},
    items: entries.map((entry) => ({ kind: 'entry', entry })),
    docs: {},
  }) as unknown as TranscriptView

test("people's messages and copied replies render in order, with each reply's tool calls settled", () => {
  const view = viewOf(
    said(1, 'Hello'),
    said(2, 'What time is it?'),
    replied(3, 2, [
      assistant([text('Checking.'), clock]),
      toolResult('c1', '12:00'),
      assistant([text('Noon.')]),
    ]),
  )
  const { items, busy } = toRoomTranscript(view)
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
    }),
    expect.objectContaining({ type: 'reply', id: 'entry:3:2', text: 'Noon.' }),
  ])

  // A stopped reply says so; a failed one with nothing said still shows it
  // failed, and one that stopped at a limit says why on its last item.
  const stopped = toRoomTranscript(
    viewOf(
      replied(4, 2, [assistant([text('Half')], 'aborted')], 'stopped'),
      replied(5, 2, [], 'failed'),
      entry(6, REPLY_KIND, {
        familiar: 3,
        name: 'Ada',
        cause: 1,
        outcome: 'failed',
        failure: { reason: 'turn_limit', detail: '40 turns' },
        messages: [assistant([text('Still working')])],
      }),
      replied(7, 3, [], 'stopped'),
    ),
  ).items
  expect(stopped).toMatchObject([
    { type: 'reply', text: 'Half', stopped: true },
    { type: 'reply', error: 'The reply failed.', retry: 5 },
    {
      type: 'reply',
      text: 'Still working',
      error: 'Stopped at its limit of 40 turns.',
    },
    { type: 'reply', id: 'entry:7', text: '', stopped: true, at: 7000 },
  ])
})

test("a failed reply can be tried again until its Familiar's next reply to the same entry, or while that's under way", () => {
  const failed = replied(3, 2, [assistant([text('Hm')], 'error')], 'failed')
  const retryOf = (...entries: EntryRecord[]) =>
    toRoomTranscript(viewOf(said(2, 'Hi'), ...entries)).items.map(
      (item) => (item.type === 'reply' && item.retry) || false,
    )

  expect(retryOf(failed)).toEqual([false, 3])
  // Another Familiar's reply to it, or Ada's to something else, changes nothing.
  expect(
    retryOf(
      failed,
      entry(4, REPLY_KIND, {
        familiar: 4,
        cause: 2,
        outcome: 'answered',
        messages: [],
      }),
      replied(5, 1, [], 'answered'),
    ),
  ).toEqual([false, 3])
  expect(retryOf(failed, replied(4, 2, [assistant([text('Hi!')])]))).toEqual([
    false,
    false,
    false,
  ])
  const retrying = toRoomTranscript(viewOf(said(2, 'Hi'), failed), {
    3: { familiar: 3, cause: 2, status: 'queued' },
  } as unknown as RoomActivity).items
  expect(retrying[1]).not.toHaveProperty('retry')
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

test("a host's note is an item of its own, with no author", () => {
  const { items } = toRoomTranscript(
    viewOf(entry(1, NOTE_KIND, { text: 'Sam joined.', at: 1000 })),
  )
  expect(items).toEqual([
    { type: 'note', id: 'entry:1', text: 'Sam joined.', at: 1000 },
  ])
})

test('running Familiars appear together without adding items to the transcript', () => {
  const view = viewOf(said(1, 'Hello'), said(2, 'Anyone there?'))
  const turns = {
    3: { familiar: 3, cause: 1, status: 'queued' },
    4: { familiar: 4, cause: 1, status: 'elsewhere' },
    5: {
      familiar: 5,
      cause: 2,
      status: 'running',
      generation: { attempt: 0, message: assistant([text('Partial')]) },
    },
    6: { familiar: 6, cause: 2, status: 'running' },
    7: { familiar: 7, cause: 100, status: 'queued' },
  } as unknown as RoomActivity
  const { items, replying, busy } = toRoomTranscript(view, turns)
  expect(items).toMatchObject([
    { type: 'message', id: 'entry:1' },
    { type: 'message', id: 'entry:2' },
  ])
  expect(replying).toEqual([{ familiar: 5 }, { familiar: 6 }])
  expect(busy).toBe(true)

  const pickedUp = toRoomTranscript(view, {
    ...turns,
    3: { ...turns[3]!, status: 'running' },
  })
  expect(pickedUp.items).toEqual(items)
  expect(pickedUp.replying).toContainEqual({ familiar: 3 })

  expect(toRoomTranscript(view, { 7: turns[7]! }).busy).toBe(true)
})

test('live tool output, questions and model retries stay with the replying Familiar', () => {
  const question = {
    id: 'q1',
    familiar: 3,
    callId: 'c3',
    tool: 'unlock',
    at: 1,
    kind: 'tool',
    arguments: {},
  }
  const retrying = { at: 5000, error: 'Rate limited' }
  const { items, replying } = toRoomTranscript(viewOf(said(1, 'Hello')), {
    3: {
      familiar: 3,
      cause: 1,
      status: 'running',
      questions: [question],
      generation: {
        attempt: 0,
        message: assistant([{ ...clock, arguments: { zone: 'UTC' } }]),
      },
      tools: [{ callId: 'c1', name: 'clock', status: 'done', output: '12:00' }],
    },
    4: {
      familiar: 4,
      cause: 1,
      status: 'running',
      generation: { attempt: 1, retry: retrying },
    },
  } as unknown as RoomActivity)
  expect(items).toHaveLength(1)
  expect(replying).toEqual([
    {
      familiar: 3,
      questions: [question],
      tools: [
        {
          id: 'c1',
          name: 'clock',
          arguments: { zone: 'UTC' },
          status: 'done',
          output: '12:00',
        },
      ],
    },
    { familiar: 4, retrying },
  ])
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
