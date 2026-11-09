import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { EntryRecord, Storage } from '@earendil-works/pi-durable'
import { expect, onTestFinished, test } from 'vitest'
import {
  MESSAGE_KIND,
  MessageError,
  SCHEDULED_KIND,
  type Author,
} from '../conversation/message.ts'
import { scriptedModels, type ScriptedRequest } from '../models/scripted.ts'
import type { Notification } from '../notify.ts'
import { fakeClock, ReopenableStorage, timeAt } from '../testing.ts'
import {
  openWorkspace,
  type FamiliarId,
  type WorkspaceOptions,
} from '../workspace/index.ts'
import type { RoomApi } from './index.ts'
import { REPLY_KIND, type ReplyData } from './log.ts'

// Rooms end to end through a workspace: posting, routing, catch-up, replies,
// restarts, Stop and schedules.

const AIDAN: Author = { id: 'aidan', name: 'Aidan' }

type Respond = (
  request: ScriptedRequest,
  signal?: AbortSignal,
) => AssistantMessage | Promise<AssistantMessage>

/** Answers each message with its own words, and anything else with "Done." */
const echo: Respond = (request) =>
  fauxAssistantMessage(
    request.type === 'message' ? `Re: ${request.text}` : 'Done.',
  )

/** A request that hangs until it's aborted, as a stopped run's does. */
const hang = (signal?: AbortSignal) =>
  new Promise<AssistantMessage>((_resolve, reject) =>
    signal?.addEventListener('abort', () => reject(new Error('aborted'))),
  )

async function open(
  respond: Respond,
  options: Partial<WorkspaceOptions> & { storage?: Storage } = {},
) {
  const workspace = await openWorkspace({
    storage: new ReopenableStorage(),
    models: scriptedModels(respond),
    model: { provider: 'faux', modelId: 'faux-1' },
    timeZone: 'UTC',
    ...options,
  })
  let open = true
  const dismiss = async () => {
    if (open) {
      open = false
      await workspace.dismiss()
    }
  }
  onTestFinished(dismiss)
  const create = async (name: string) =>
    (await workspace.familiars.create({ name })).id
  const room = async (id: number) => (await workspace.rooms.get(id as never))!
  return { workspace, dismiss, create, room }
}

/** A watch's value at once. */
const read = async <T>(
  watch: () => Promise<{ value: T; stop(): Promise<unknown> }>,
) => {
  const opened = await watch()
  await opened.stop()
  return opened.value
}

const log = async (room: RoomApi) =>
  (await read(() => room.watch())).entries as EntryRecord[]

const replies = async (room: RoomApi) =>
  (await log(room))
    .filter((entry) => entry.kind === REPLY_KIND)
    .map((entry) => entry.data as unknown as ReplyData)

/** What a reply said, without its tool calls. */
const said = (reply: ReplyData) =>
  reply.messages
    .flatMap((message) =>
      message.role === 'assistant'
        ? message.content.flatMap((part) =>
            part.type === 'text' ? [part.text] : [],
          )
        : [],
    )
    .join('\n')

test('a DM delivers a message to its Familiar once, and copies the answer back as its reply', async () => {
  const { workspace, create, room } = await open(echo)
  const ada = await create('Ada')
  const id = await workspace.rooms.dm(ada, AIDAN.id)
  expect(await workspace.rooms.dm(ada, AIDAN.id)).toBe(id)

  const dm = await room(id)
  const message = { author: AIDAN, text: 'Hi Ada', requestId: 'm1' }
  const entry = await dm.post(message)
  expect(await dm.post(message)).toBe(entry)

  await expect.poll(async () => (await replies(dm)).length).toBe(1)
  const [reply] = await replies(dm)
  expect(reply).toMatchObject({
    familiar: ada,
    name: 'Ada',
    cause: entry,
    outcome: 'answered',
  })
  expect(said(reply)).toBe('Re: Hi Ada')
  expect((await log(dm)).map((entry) => entry.kind)).toEqual([
    MESSAGE_KIND,
    REPLY_KIND,
  ])
  expect(await read(() => dm.watchTurns())).toEqual({})

  // The chat keeps the message as memory, recall and tools read it, with
  // where it came from.
  const inputs = (
    await read(() => workspace.familiars.get(ada)!.watch())
  ).entries.filter((entry) => entry.kind === MESSAGE_KIND)
  expect(inputs.map((entry) => entry.data)).toEqual([
    {
      author: AIDAN,
      text: 'Hi Ada',
      room: id,
      context: '[In your DM with Aidan]',
    },
  ])
})

test('in a named room, mentioned Familiars answer, once each, and the lead answers the rest', async () => {
  const { workspace, create, room } = await open(echo)
  const [ada, bo, cy] = [
    await create('Ada'),
    await create('Bo'),
    await create('Cy'),
  ]
  const kitchen = await room(
    await workspace.rooms.create({
      name: 'kitchen',
      familiars: [ada, bo],
      lead: ada,
    }),
  )
  const mention = (familiar: FamiliarId, start: number) => ({
    kind: 'familiar' as const,
    id: String(familiar),
    start,
    end: start + 3,
  })

  await kitchen.post({
    author: AIDAN,
    text: "@Bo @Bo what's for dinner?",
    requestId: 'm1',
    mentions: [mention(bo, 0), mention(bo, 4)],
  })
  await expect.poll(async () => (await replies(kitchen)).length).toBe(1)
  await kitchen.post({ author: AIDAN, text: 'Thanks!', requestId: 'm2' })
  await expect.poll(async () => (await replies(kitchen)).length).toBe(2)

  expect(
    (await replies(kitchen)).map((reply) => [reply.familiar, said(reply)]),
  ).toEqual([
    [bo, "Re: @Bo @Bo what's for dinner?"],
    [ada, 'Re: Thanks!'],
  ])

  // A mention must span an @name, and name a Familiar in the room.
  for (const mentions of [[mention(bo, 1)], [mention(cy, 0)]]) {
    await expect(
      kitchen.post({
        author: AIDAN,
        text: '@Bo hi',
        requestId: 'm3',
        mentions,
      }),
    ).rejects.toThrow(MessageError)
  }
  expect(await log(kitchen)).toHaveLength(4)
})

test('a Familiar coming back to a room is shown what it missed there, and the thread it left', async () => {
  const { workspace, create, room } = await open(echo)
  const [ada, bo] = [await create('Ada'), await create('Bo')]
  const kitchen = await room(
    await workspace.rooms.create({
      name: 'kitchen',
      familiars: [ada, bo],
      lead: ada,
    }),
  )
  const dm = await room(await workspace.rooms.dm(ada, AIDAN.id))
  const say = async (to: RoomApi, text: string, mentions?: FamiliarId) => {
    const before = (await replies(to)).length
    await to.post({
      author: AIDAN,
      text,
      requestId: text,
      ...(mentions !== undefined && {
        mentions: [
          { kind: 'familiar', id: String(mentions), start: 0, end: 3 },
        ],
      }),
    })
    await expect.poll(async () => (await replies(to)).length).toBe(before + 1)
  }

  await say(kitchen, 'Paint the fence blue.')
  await say(dm, 'What time is it?')
  await say(kitchen, '@Bo buy the paint.', bo)
  await say(kitchen, 'Which colour?')

  const contexts = (
    await read(() => workspace.familiars.get(ada)!.watch())
  ).entries.flatMap((entry) =>
    entry.kind === MESSAGE_KIND
      ? [(entry.data as { context: string }).context]
      : [],
  )
  expect(contexts).toEqual([
    '[In #kitchen]',
    '[In your DM with Aidan]',
    [
      '[In #kitchen]',
      'Earlier in this room:',
      '[Aidan]: Paint the fence blue.',
      '[Ada]: Re: Paint the fence blue.',
      'Said here since your last turn:',
      '[Aidan]: @Bo buy the paint.',
      '[Bo]: Re: @Bo buy the paint.',
    ].join('\n'),
  ])
})

test('a restart mid-turn finishes the turn without a second message, input or reply', async () => {
  const storage = new ReopenableStorage()
  const first = await open((_request, signal) => hang(signal), { storage })
  const ada = await first.create('Ada')
  const id = await first.workspace.rooms.dm(ada, AIDAN.id)
  const message = { author: AIDAN, text: 'Hi Ada', requestId: 'm1' }
  await (await first.room(id)).post(message)
  await expect
    .poll(
      async () =>
        (await read(() => first.workspace.familiars.get(ada)!.watch())).docs[
          'pi.live'
        ]?.run,
    )
    .toBeDefined()
  await first.dismiss()

  const second = await open(echo, { storage })
  const dm = await second.room(id)
  // The client retries too, not knowing it got through.
  await dm.post(message)
  await expect.poll(async () => (await replies(dm)).length).toBe(1)
  await new Promise((resolve) => setTimeout(resolve, 100))

  expect((await log(dm)).map((entry) => entry.kind)).toEqual([
    MESSAGE_KIND,
    REPLY_KIND,
  ])
  expect(said((await replies(dm))[0])).toBe('Re: Hi Ada')
  const chat = (await read(() => second.workspace.familiars.get(ada)!.watch()))
    .entries
  expect(chat.filter((entry) => entry.kind === MESSAGE_KIND)).toHaveLength(1)
  expect(chat.filter((entry) => entry.kind === 'pi.assistant')).toHaveLength(1)
})

test("stopping a room stops only its own turns: other rooms' work, in the same Familiar too, carries on", async () => {
  // Messages saying "hold" take until they're released or stopped.
  const held = new Map<string, () => void>()
  const { workspace, create, room } = await open((request, signal) => {
    if (request.type !== 'message' || !request.text.includes('hold')) {
      return echo(request)
    }
    return new Promise((resolve, reject) => {
      held.set(request.text, () => resolve(echo(request) as AssistantMessage))
      signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })
  })
  const [ada, bo] = [await create('Ada'), await create('Bo')]
  const named = async (name: string) =>
    room(await workspace.rooms.create({ name, familiars: [ada], lead: ada }))
  const [busy, waiting] = [await named('busy'), await named('waiting')]
  const adaDm = await room(await workspace.rooms.dm(ada, AIDAN.id))
  const boDm = await room(await workspace.rooms.dm(bo, AIDAN.id))
  const live = async (familiar: FamiliarId) =>
    (await read(() => workspace.familiars.get(familiar)!.watch())).docs as {
      'pi.live': { run?: unknown }
      'pi.inbox': { items: unknown[] }
    }
  const post = (to: RoomApi, text: string) =>
    to.post({ author: AIDAN, text, requestId: text })

  await post(busy, 'hold the long job')
  await post(boDm, 'hold on, Bo')
  await expect.poll(() => held.size).toBe(2)
  await post(waiting, 'queued here')
  await post(adaDm, 'queued in the DM')
  await expect
    .poll(async () => (await live(ada))['pi.inbox'].items.length)
    .toBe(2)

  // A queued turn is withdrawn alone.
  await waiting.stop()
  expect(await replies(waiting)).toEqual([])
  expect(await read(() => waiting.watchTurns())).toEqual({})
  expect((await live(ada))['pi.inbox'].items).toHaveLength(1)
  expect((await live(ada))['pi.live'].run).toBeDefined()

  // A running turn's run is stopped alone, and the DM's turn goes next.
  await busy.stop()
  expect(await replies(busy)).toEqual([])
  await expect.poll(async () => (await replies(adaDm)).length).toBe(1)
  expect(said((await replies(adaDm))[0])).toBe('Re: queued in the DM')

  // Bo was never touched.
  expect((await live(bo))['pi.live'].run).toBeDefined()
  held.get('hold on, Bo')!()
  await expect.poll(async () => (await replies(boDm)).length).toBe(1)
  expect((await replies(boDm))[0].outcome).toBe('answered')
})

test('a schedule made in a room runs there when due, and notifies with its reply', async () => {
  const clock = fakeClock(timeAt('2030-01-01 08:00', 'UTC'))
  const notifications: Notification[] = []
  const { workspace, create, room } = await open(
    (request) =>
      request.type === 'scheduled'
        ? fauxAssistantMessage('Time to buy milk, Aidan!')
        : request.type === 'tool-result'
          ? fauxAssistantMessage('I will remind you.')
          : fauxAssistantMessage(
              [
                fauxToolCall('schedule', {
                  prompt: 'Remind Aidan to buy milk',
                  at: '2030-01-01 09:00',
                }),
              ],
              { stopReason: 'toolUse' },
            ),
    {
      now: clock.now,
      setTimer: clock.setTimer,
      notify: async (notification) => {
        notifications.push(notification)
      },
    },
  )
  const ada = await create('Ada')
  const kitchen = await room(
    await workspace.rooms.create({
      name: 'kitchen',
      familiars: [ada],
      lead: ada,
    }),
  )
  await kitchen.post({
    author: AIDAN,
    text: 'Remind me to buy milk at 9.',
    requestId: 'm1',
  })
  await expect.poll(async () => (await replies(kitchen)).length).toBe(1)
  // The reply keeps the run's tool activity.
  expect(
    (await replies(kitchen))[0].messages.map((message) => message.role),
  ).toEqual(['assistant', 'toolResult', 'assistant'])

  clock.advanceTo(timeAt('2030-01-01 09:00', 'UTC'))
  await expect.poll(async () => (await replies(kitchen)).length).toBe(2)
  const entries = await log(kitchen)
  expect(entries.map((entry) => entry.kind)).toEqual([
    MESSAGE_KIND,
    REPLY_KIND,
    SCHEDULED_KIND,
    REPLY_KIND,
  ])
  expect(entries[2].data).toMatchObject({
    familiar: ada,
    prompt: 'Remind Aidan to buy milk',
    creator: AIDAN,
  })
  expect(said((await replies(kitchen))[1])).toBe('Time to buy milk, Aidan!')
  await expect
    .poll(() => notifications)
    .toEqual([{ title: 'Ada', body: 'Time to buy milk, Aidan!', url: '/' }])
})

test("a schedule whose room was archived runs in its Familiar's DM with whoever made it", async () => {
  const clock = fakeClock(timeAt('2030-01-01 08:00', 'UTC'))
  const { workspace, create, room } = await open(
    (request) =>
      request.type === 'scheduled'
        ? fauxAssistantMessage('Time to buy milk, Aidan!')
        : request.type === 'tool-result'
          ? fauxAssistantMessage('I will remind you.')
          : fauxAssistantMessage(
              [
                fauxToolCall('schedule', {
                  prompt: 'Remind Aidan to buy milk',
                  at: '2030-01-01 09:00',
                }),
              ],
              { stopReason: 'toolUse' },
            ),
    { now: clock.now, setTimer: clock.setTimer },
  )
  const ada = await create('Ada')
  const id = await workspace.rooms.create({
    name: 'kitchen',
    familiars: [ada],
    lead: ada,
  })
  const kitchen = await room(id)
  await kitchen.post({
    author: AIDAN,
    text: 'Remind me to buy milk at 9.',
    requestId: 'm1',
  })
  await expect.poll(async () => (await replies(kitchen)).length).toBe(1)
  await workspace.rooms.archive(id)

  clock.advanceTo(timeAt('2030-01-01 09:00', 'UTC'))
  const dm = await room(await workspace.rooms.dm(ada, AIDAN.id))
  await expect.poll(async () => (await replies(dm)).length).toBe(1)
  expect((await log(dm)).map((entry) => entry.kind)).toEqual([
    SCHEDULED_KIND,
    REPLY_KIND,
  ])
  expect(said((await replies(dm))[0])).toBe('Time to buy milk, Aidan!')
  expect(await replies(kitchen)).toHaveLength(1)
})
