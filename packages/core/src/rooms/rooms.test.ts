import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { EntryRecord, Storage } from '@earendil-works/pi-durable'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { expect, onTestFinished, test } from 'vitest'
import {
  HANDOFF_KIND,
  MESSAGE_KIND,
  MessageError,
  SCHEDULED_KIND,
  type Author,
} from '../conversation/message.ts'
import { scriptedModels, type ScriptedRequest } from '../models/scripted.ts'
import {
  definePlugin,
  defineTool,
  familiar as services,
  Type,
} from '../index.ts'
import { Facts } from '../memory/facts.ts'
import { withHarness } from '../memory/testing.ts'
import type { Notification } from '../notify.ts'
import { Schedules } from '../schedules/schedules.ts'
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
    (
      await workspace.familiars.create({
        name,
        // Every plugin the test installs: each Familiar opts in.
        capabilities: {
          plugins: (options.plugins ?? []).map((plugin) => plugin.name),
        },
      })
    ).id
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

/** A tool call, as the model's whole answer. */
const call = (name: string, args: Record<string, string>) =>
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: 'toolUse' })

/** What a request's Familiar was shown from the room with its input. */
const shown = (request: ScriptedRequest) => {
  const input = request.context.messages.findLast(
    (message) => message.role === 'user',
  )
  return Array.isArray(input?.content) && input.content[0].type === 'text'
    ? input.content[0].text
    : ''
}

/** Mentions `familiar` as `@Xx` at `start`. */
const mention = (familiar: FamiliarId, start = 0) => ({
  kind: 'familiar' as const,
  id: String(familiar),
  start,
  end: start + 3,
})

/** The inputs a Familiar's chat was given from rooms, with where from. */
const inputs = async (
  workspace: Awaited<ReturnType<typeof open>>['workspace'],
  familiar: FamiliarId,
) =>
  (await read(() => workspace.familiars.get(familiar)!.watch())).entries
    .filter((entry) => entry.data && 'addressed' in (entry.data as object))
    .map((entry) => entry.data as { context: string; addressed: string })

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
      entry,
      context: '[In your DM with Aidan]',
      addressed: 'dm',
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

  // Clearing the lead opens the room to both.
  await workspace.rooms.update(kitchen.id, { lead: null })
  await kitchen.post({ author: AIDAN, text: 'Anyone?', requestId: 'm4' })
  await expect.poll(async () => (await replies(kitchen)).length).toBe(4)
  expect(
    (await replies(kitchen)).slice(2).map((reply) => reply.familiar),
  ).toEqual([ada, bo])
})

test('in an open room, each Familiar takes a turn in order, shown the replies before it, and may stay quiet; a mention still goes only to whom it names', async () => {
  const { workspace, create, room } = await open((request) =>
    request.type === 'message' &&
    shown(request).includes("Said here since what you're answering:")
      ? call('stay_quiet', { reason: 'Already answered.' })
      : echo(request),
  )
  const [ada, bo] = [await create('Ada'), await create('Bo')]
  const kitchen = await room(
    await workspace.rooms.create({ name: 'kitchen', familiars: [ada, bo] }),
  )

  await kitchen.post({ author: AIDAN, text: 'Dinner?', requestId: 'm1' })
  await expect.poll(async () => (await replies(kitchen)).length).toBe(2)
  const [first, second] = await replies(kitchen)
  expect([first.familiar, first.outcome, said(first)]).toEqual([
    ada,
    'answered',
    'Re: Dinner?',
  ])
  // Bo was shown Ada's reply, and passed, saying nothing.
  expect([second.familiar, second.outcome, said(second)]).toEqual([
    bo,
    'quiet',
    '',
  ])
  expect(second.messages.map((message) => message.role)).toEqual([
    'assistant',
    'toolResult',
  ])
  expect((await inputs(workspace, bo))[0]).toEqual(
    expect.objectContaining({
      addressed: 'open',
      context: [
        '[In #kitchen, where everyone takes a turn]',
        "Said here since what you're answering:",
        '[Ada]: Re: Dinner?',
      ].join('\n'),
    }),
  )

  // A mention goes to Bo alone, and its catch-up shows no line for a quiet reply.
  await kitchen.post({
    author: AIDAN,
    text: '@Bo pudding?',
    requestId: 'm2',
    mentions: [mention(bo)],
  })
  await expect.poll(async () => (await replies(kitchen)).length).toBe(3)
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(
    (await replies(kitchen)).map((reply) => [reply.familiar, said(reply)]),
  ).toEqual([
    [ada, 'Re: Dinner?'],
    [bo, ''],
    [bo, 'Re: @Bo pudding?'],
  ])
  expect((await inputs(workspace, bo))[1]).toMatchObject({
    addressed: 'mention',
    context: '[In #kitchen, where you were mentioned]',
  })
})

test('a handoff gives the Familiar it names a turn on its note, and a chain past maxHandoffs is refused', async () => {
  const { workspace, create, room } = await open(
    (request) => {
      switch (request.type) {
        case 'message':
          return call('hand_off', { to: 'Bo', note: 'Which paint?' })
        case 'handoff':
          return request.from === 'Ada'
            ? call('hand_off', { to: 'ada', note: 'Which colour?' })
            : call('hand_off', { to: 'Bo', note: 'Ask again.' })
        case 'tool-result':
          return fauxAssistantMessage(
            request.isError ? `Refused: ${request.output}` : 'Handed on.',
          )
        default:
          return echo(request)
      }
    },
    { maxHandoffs: 2 },
  )
  const [ada, bo] = [await create('Ada'), await create('Bo')]
  const kitchen = await room(
    await workspace.rooms.create({
      name: 'kitchen',
      familiars: [ada, bo],
      lead: ada,
    }),
  )
  const message = await kitchen.post({
    author: AIDAN,
    text: 'Paint the fence.',
    requestId: 'm1',
  })
  await expect.poll(async () => (await replies(kitchen)).length).toBe(3)

  const entries = await log(kitchen)
  const handoffs = entries.filter((entry) => entry.kind === HANDOFF_KIND)
  expect(handoffs.map((entry) => entry.data)).toEqual([
    expect.objectContaining({
      from: ada,
      to: bo,
      note: 'Which paint?',
      hops: 1,
      cause: message,
    }),
    expect.objectContaining({
      from: bo,
      to: ada,
      note: 'Which colour?',
      hops: 2,
      cause: handoffs[0].id,
    }),
  ])
  // Bo's input is the note, after what it missed.
  const [toBo] = await inputs(workspace, bo)
  expect(toBo).toMatchObject({
    from: ada,
    name: 'Ada',
    note: 'Which paint?',
    addressed: 'handoff',
    context: [
      '[In #kitchen, handed to you]',
      'Said here before:',
      '[Aidan]: Paint the fence.',
    ].join('\n'),
  })
  // Ada is shown the handoff she made as a line, and a third is refused.
  const [, toAda] = await inputs(workspace, ada)
  expect(toAda.context).toContain('[Ada → Bo]: Which paint?')
  const last = (await replies(kitchen)).find(
    (reply) => reply.cause === handoffs[1].id,
  )!
  expect(said(last)).toMatch(/^Refused: [\s\S]*handed on 2 times/)
})

test("stopping a room stops a handoff's turn too", async () => {
  const held: string[] = []
  const { workspace, create, room } = await open((request, signal) => {
    if (request.type === 'message') {
      return call('hand_off', { to: 'Bo', note: 'Take this one.' })
    }
    if (request.type === 'handoff') {
      held.push(request.note)
      return hang(signal)
    }
    return fauxAssistantMessage('Asked Bo.')
  })
  const [ada, bo] = [await create('Ada'), await create('Bo')]
  const kitchen = await room(
    await workspace.rooms.create({
      name: 'kitchen',
      familiars: [ada, bo],
      lead: ada,
    }),
  )
  await kitchen.post({ author: AIDAN, text: 'Help?', requestId: 'm1' })
  await expect.poll(() => held).toEqual(['Take this one.'])

  await kitchen.stop()
  expect(await read(() => kitchen.watchTurns())).toEqual({})
  expect((await replies(kitchen)).map((reply) => reply.familiar)).toEqual([ada])
  const live = (await read(() => workspace.familiars.get(bo)!.watch())).docs[
    'pi.live'
  ] as { run?: unknown }
  expect(live.run).toBeUndefined()
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
        mentions: [mention(mentions)],
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
    '[In #kitchen, which you lead]',
    '[In your DM with Aidan]',
    [
      '[In #kitchen, which you lead]',
      'Earlier in this room:',
      '[Aidan]: Paint the fence blue.',
      '[Ada]: Re: Paint the fence blue.',
      'Said here since your last turn:',
      '[Aidan]: @Bo buy the paint.',
      '[Bo]: Re: @Bo buy the paint.',
    ].join('\n'),
  ])
})

test("a host's note is shown to each Familiar on its next turn and causes no turn", async () => {
  const { workspace, create, room } = await open(echo)
  const [ada, bo] = [await create('Ada'), await create('Bo')]
  const kitchen = await room(
    await workspace.rooms.create({
      name: 'kitchen',
      familiars: [ada, bo],
      lead: ada,
    }),
  )

  const note = await kitchen.note({ text: 'Sam joined.', requestId: 'n1' })
  // A retry posts nothing; a note is as bounded as a message.
  expect(await kitchen.note({ text: 'Sam joined.', requestId: 'n1' })).toBe(
    note,
  )
  await expect(
    kitchen.note({ text: '  ', requestId: 'n2' }),
  ).rejects.toBeInstanceOf(MessageError)

  // The message queues behind any turn the note caused: the first reply is
  // to the message, and the lead's only input is the message.
  const message = await kitchen.post({
    author: AIDAN,
    text: 'Dinner?',
    requestId: 'm1',
  })
  await expect.poll(async () => (await replies(kitchen)).length).toBe(1)
  expect((await replies(kitchen))[0].cause).toBe(message)
  expect(await inputs(workspace, ada)).toEqual([
    expect.objectContaining({
      context: [
        '[In #kitchen, which you lead]',
        'Said here before:',
        '[Note]: Sam joined.',
      ].join('\n'),
    }),
  ])
  expect(await inputs(workspace, bo)).toEqual([])
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

test('a handoff turn acts for the person whose message started it', async () => {
  const seen: (string | undefined)[] = []
  const whoami = definePlugin({
    name: 'whoami',
    title: 'Who am I',
    tools: [
      defineTool({
        name: 'whoami',
        description: 'Who this turn is for',
        parameters: Type.Object({}),
        execute: async (_args, _api, context) => {
          seen.push((await services(context).author())?.name)
          return { output: [{ type: 'text', text: 'ok' }] }
        },
      }),
    ],
  })
  const { workspace, create, room } = await open(
    (request) => {
      switch (request.type) {
        case 'message':
          return call('hand_off', { to: 'Bo', note: 'Who is this for?' })
        case 'handoff':
          return call('whoami', {})
        default:
          return fauxAssistantMessage('Done.')
      }
    },
    { plugins: [whoami] },
  )
  const [ada, bo] = [await create('Ada'), await create('Bo')]
  const kitchen = await room(
    await workspace.rooms.create({
      name: 'kitchen',
      familiars: [ada, bo],
      lead: ada,
    }),
  )
  await kitchen.post({ author: AIDAN, text: 'Ask Bo.', requestId: 'm1' })
  await expect.poll(() => seen).toEqual(['Aidan'])
})

test("removing a Familiar stops its turns and schedules, retires its memory, opens the room it led and closes its DM, leaving others' work running", async () => {
  // Messages saying "hold" take until they're released or stopped.
  const held = new Map<string, () => void>()
  const storage = new ReopenableStorage()
  const { workspace, dismiss, create, room } = await open(
    (request, signal) => {
      if (request.type === 'tool-result') {
        return fauxAssistantMessage('I will remind you.')
      }
      if (request.type === 'message' && request.text.startsWith('Remind')) {
        return call('schedule', {
          prompt: 'Remind Aidan to call Mum',
          at: '2099-01-01 09:00',
        })
      }
      if (request.type !== 'message' || !request.text.includes('hold')) {
        return echo(request)
      }
      return new Promise((resolve, reject) => {
        held.set(request.text, () => resolve(echo(request) as AssistantMessage))
        signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    },
    { storage },
  )
  const [ada, bo] = [await create('Ada'), await create('Bo')]
  const adaDm = await room(await workspace.rooms.dm(ada, AIDAN.id))
  await adaDm.post({ author: AIDAN, text: 'Remind me at 9.', requestId: 'r' })
  await expect.poll(async () => (await replies(adaDm)).length).toBe(1)
  const kitchen = await room(
    await workspace.rooms.create({
      name: 'kitchen',
      familiars: [ada, bo],
      lead: ada,
    }),
  )
  const post = (text: string, mentions?: ReturnType<typeof mention>[]) =>
    kitchen.post({ author: AIDAN, text, requestId: text, mentions })
  await post('@Bo hold on', [mention(bo)])
  await post('hold the soup')
  await post('queued for Ada')
  await expect.poll(() => held.size).toBe(2)
  await expect
    .poll(
      async () =>
        (await read(() => workspace.familiars.get(ada)!.watch())).docs[
          'pi.inbox'
        ] as { items: unknown[] },
    )
    .toMatchObject({ items: [expect.anything()] })

  await workspace.familiars.remove(ada)

  // Gone from the workspace, and from the room it led, which is open now.
  expect(workspace.familiars.get(ada)).toBeUndefined()
  expect((await workspace.familiars.list()).map(({ id }) => id)).toEqual([bo])
  const rooms = await workspace.rooms.list()
  expect(rooms.find(({ id }) => id === kitchen.id)).toEqual({
    id: kitchen.id,
    kind: 'room',
    name: 'kitchen',
    familiars: [bo],
  })
  // Its running and queued turns are stopped; Bo's carries on.
  expect(Object.values(await read(() => kitchen.watchTurns()))).toEqual([
    expect.objectContaining({ familiar: bo }),
  ])
  held.get('@Bo hold on')!()
  await expect
    .poll(async () => (await replies(kitchen)).map((reply) => reply.familiar))
    .toEqual([bo])
  // Its DM keeps its history and takes nothing new.
  expect((await replies(adaDm)).map(said)).toEqual(['I will remind you.'])
  await expect(
    adaDm.post({ author: AIDAN, text: 'Hello?', requestId: 'h' }),
  ).rejects.toThrow('This Familiar was removed.')

  // Its schedule and upkeep stopped, and its memory and schedules are retired.
  await dismiss()
  await withHarness(storage, async (harness) => {
    const { items } = await storage.scanTasks({}, 100, undefined, context)
    const ofAda = items.filter(
      (task) =>
        (task.kind === 'familiar.schedule' ||
          task.kind === 'familiar.upkeep') &&
        (task.input as { familiar: FamiliarId }).familiar === ada,
    )
    expect(ofAda.map((task) => [task.kind, task.state.status]).sort()).toEqual([
      ['familiar.schedule', 'terminal'],
      ['familiar.upkeep', 'terminal'],
    ])
    expect(await harness.snapshot(Facts, String(ada), context)).toBeUndefined()
    expect(
      await harness.snapshot(Schedules, String(ada), context),
    ).toBeUndefined()
    expect(await harness.snapshot(Facts, String(bo), context)).toBeDefined()
  })
})
