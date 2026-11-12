import { applyImmutable, type Op } from '@earendil-works/chord/delta'
import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import type { WatchHandle } from '@earendil-works/pi-durable'
import { testClient } from 'hono/testing'
import { expect, test, vi } from 'vitest'
import type { Author } from '../conversation/message.ts'
import {
  defineTool,
  MESSAGE_LIMITS,
  Type,
  type RoomActivity,
  type Workspace,
} from '../index.ts'
import { storageWith } from '../memory/testing.ts'
import { testHost } from '../testing.ts'
import {
  createHttpApi,
  DEFAULT_MAX_BODY_SIZE,
  type Allow,
  type HttpOptions,
  type Operation,
  type PushHost,
  type Resource,
} from './index.ts'

const sam: Author = { id: 'sam', name: 'Sam' }

const api = (workspace: Workspace, options: Partial<HttpOptions> = {}) =>
  createHttpApi(workspace, {
    authenticate: () => sam,
    allow: () => true,
    ...options,
  })

type App = {
  request(path: string, init?: RequestInit): Promise<Response> | Response
}

const send = (
  app: App,
  method: string,
  path: string,
  body: BodyInit,
  headers: Record<string, string> = {},
) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body,
    duplex: 'half',
  } as RequestInit)

const post = (
  app: App,
  path: string,
  body: BodyInit,
  headers?: Record<string, string>,
) => send(app, 'POST', path, body, headers)

/**
 * Reads a stream's events as they come: their names in order, and each
 * document's value with every change applied.
 */
function events(response: Response) {
  expect(response.status).toBe(200)
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  const names: string[] = []
  const documents: Record<string, unknown> = {}
  let buffer = ''
  const read = async () => {
    const chunk = await reader.read()
    expect(chunk.done).toBe(false)
    buffer += chunk.value
    const frames = buffer.split('\n\n')
    buffer = frames.pop()!
    for (const frame of frames) {
      const match = /^event: (.+)\ndata: (.+)$/m.exec(frame)
      if (!match) {
        continue
      }
      const [, event, raw] = match
      const data = JSON.parse(raw)
      if (event === 'document') {
        names.push(`document ${data.name}`)
        documents[data.name] = data.value
      } else if (event === 'document.ops') {
        documents[data.name] = applyImmutable(
          documents[data.name],
          data.ops as Op[],
        )
      } else {
        names.push(event)
      }
    }
  }
  return {
    names,
    documents,
    reader,
    /** Reads until `done` holds. */
    until: async (done: () => boolean) => {
      while (!done()) {
        await read()
      }
    },
  }
}

test('a request is authenticated, then bounded, then allowed, before any route reads it', async () => {
  const host = await testHost({ person: sam })
  const room = host.dm()
  const posted = vi.spyOn(room, 'post')
  vi.spyOn(host.workspace().rooms, 'get').mockResolvedValue(room)
  const allow = vi.fn<Allow>((_, operation) => operation !== 'rooms.post')
  const app = api(host.workspace(), {
    authenticate: (request) =>
      request.headers.get('x-person') === 'sam' ? sam : undefined,
    allow,
  })
  const path = `/rooms/${room.id}/messages`
  const message = JSON.stringify({ text: 'Hi', requestId: 'hi' })
  const huge = JSON.stringify({
    text: 'x'.repeat(DEFAULT_MAX_BODY_SIZE),
    requestId: 'huge',
  })
  // Streamed, so no Content-Length says how big it is.
  const streamed = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(huge))
      controller.close()
    },
  })

  expect((await post(app, path, message)).status).toBe(401)
  expect((await post(app, path, huge, { 'x-person': 'sam' })).status).toBe(413)
  expect((await post(app, path, streamed, { 'x-person': 'sam' })).status).toBe(
    413,
  )
  expect(allow).not.toHaveBeenCalled()

  expect((await post(app, path, message, { 'x-person': 'sam' })).status).toBe(
    403,
  )
  expect(allow).toHaveBeenCalledWith(sam, 'rooms.post', { room: room.id })
  expect(posted).not.toHaveBeenCalled()
})

// Every route and the one operation it asks about. Keyed by Operation, so
// an operation added without a route here is a type error. Familiar 7 and
// room 9 don't exist: access is asked before anything is looked up.
const ROUTES = {
  'account.state': ['GET', '/account'],
  'account.signIn': ['POST', '/account/sign-in'],
  'account.answerSignIn': ['POST', '/account/sign-in/answer'],
  'account.cancelSignIn': ['DELETE', '/account/sign-in'],
  'account.signOut': ['POST', '/account/sign-out'],
  'push.key': ['GET', '/push/key'],
  'push.subscribe': ['POST', '/push/subscriptions'],
  'push.unsubscribe': ['DELETE', '/push/subscriptions'],
  'connections.list': ['GET', '/connections'],
  'connections.setSecret': ['PUT', '/connections/plugin/notes/secrets/token'],
  'connections.deleteSecret': [
    'DELETE',
    '/connections/plugin/notes/secrets/token',
  ],
  'mcp.add': ['POST', '/mcp'],
  'mcp.remove': ['DELETE', '/mcp/notes'],
  'mcp.reconnect': ['POST', '/mcp/notes/reconnect'],
  'familiars.list': ['GET', '/familiars'],
  'familiars.create': ['POST', '/familiars'],
  'defaults.get': ['GET', '/defaults/capabilities'],
  'defaults.set': ['PUT', '/defaults/capabilities'],
  'rooms.list': ['GET', '/rooms'],
  'rooms.create': ['POST', '/rooms'],
  'me.get': ['GET', '/me'],
  'me.update': ['PATCH', '/me'],
  'familiars.update': ['PATCH', '/familiars/7'],
  'familiars.remove': ['DELETE', '/familiars/7'],
  'familiars.dm': ['POST', '/familiars/7/dm'],
  'memory.revise': ['PUT', '/familiars/7/memory/f1'],
  'memory.retire': ['POST', '/familiars/7/memory/f1/retire'],
  'memory.setPinned': ['PUT', '/familiars/7/memory/f1/pin'],
  'schedules.cancel': ['DELETE', '/familiars/7/schedules/s1'],
  'schedules.pause': ['POST', '/familiars/7/schedules/s1/pause'],
  'schedules.resume': ['POST', '/familiars/7/schedules/s1/resume'],
  'model.options': ['GET', '/familiars/7/model/options'],
  'model.set': ['PUT', '/familiars/7/model'],
  'model.setThinkingLevel': ['PUT', '/familiars/7/model/thinking-level'],
  'capabilities.get': ['GET', '/familiars/7/capabilities'],
  'capabilities.set': ['PUT', '/familiars/7/capabilities'],
  'rooms.update': ['PATCH', '/rooms/9'],
  'rooms.archive': ['DELETE', '/rooms/9'],
  'rooms.post': ['POST', '/rooms/9/messages'],
  'rooms.note': ['POST', '/rooms/9/notes'],
  'rooms.read': ['POST', '/rooms/9/read'],
  'rooms.history': ['GET', '/rooms/9/history?before=1'],
  'rooms.retry': ['POST', '/rooms/9/retry'],
  'rooms.stop': ['POST', '/rooms/9/stop'],
} satisfies Record<
  Exclude<Operation, `events.${string}`>,
  [method: string, path: string]
>

/** The resource a route's path names, as `allow` should be told it. */
const resourceIn = (path: string): Resource | undefined =>
  path.startsWith('/familiars/')
    ? { familiar: 7 as never }
    : path.startsWith('/rooms/')
      ? { room: 9 as never }
      : undefined

test('each route asks about its own operation and resource alone, and is refused before it runs', async () => {
  const asked: [Operation, Resource | undefined][] = []
  const app = api((await testHost({ person: sam })).workspace(), {
    allow: (_, operation, resource) => {
      asked.push([operation, resource])
      return false
    },
  })
  for (const [operation, [method, path]] of Object.entries(ROUTES)) {
    asked.length = 0
    const response = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(method === 'GET' ? {} : { body: '{}' }),
    })
    expect([response.status, asked], `${method} ${path}`).toEqual([
      403,
      [[operation, resourceIn(path)]],
    ])
  }

  const streams = {
    '/events': [
      'events.familiars',
      'events.rooms',
      'events.me',
      'events.account',
    ],
    '/familiars/7/events': [
      'events.model',
      'events.memory',
      'events.episodes',
      'events.schedules',
    ],
    '/rooms/9/events': ['events.room'],
  }
  for (const [path, operations] of Object.entries(streams)) {
    asked.length = 0
    expect((await app.request(path)).status).toBe(403)
    expect(asked).toEqual(
      operations.map((operation) => [operation, resourceIn(path)]),
    )
  }
})

test("posting to a room validates what clients send, takes the author from the host, and 404s a room that isn't there", async () => {
  const host = await testHost({ person: sam })
  host.faux.setResponses([fauxAssistantMessage('Hello.')])
  const app = api(host.workspace())
  const client = testClient(app)
  const room = String(host.dm().id)

  const sent = await post(
    app,
    `/rooms/${room}/messages`,
    JSON.stringify({
      text: 'Hi',
      requestId: 'hi',
      author: { id: 'x', name: 'Spoofed' },
    }),
  )
  expect(sent.status).toBe(202)

  for (const json of [
    { text: ' ', requestId: 'r' },
    { text: 'x'.repeat(MESSAGE_LIMITS.text + 1), requestId: 'r' },
    // A mention must span an @name in the text.
    {
      text: 'Hi',
      requestId: 'r',
      mentions: [{ kind: 'person' as const, id: 'sam', start: 0, end: 2 }],
    },
  ]) {
    const refused = await client.rooms[':room'].messages.$post({
      param: { room },
      json,
    })
    expect(refused.status).toBe(400)
  }
  expect(
    (
      await client.rooms[':room'].history.$get({
        param: { room },
        query: { before: 'latest' },
      })
    ).status,
  ).toBe(400)
  const missing = await client.rooms[':room'].messages.$post({
    param: { room: '999' },
    json: { text: 'Hi', requestId: 'r' },
  })
  expect(missing.status).toBe(404)

  const response = await client.rooms[':room'].history.$get({
    param: { room },
    query: { before: String(Number.MAX_SAFE_INTEGER) },
  })
  if (!response.ok) {
    throw new Error(`history failed: ${response.status}`)
  }
  const page = await response.json()
  expect(page.entries.at(-1)?.data).toMatchObject({ author: sam, text: 'Hi' })
})

test("the DM endpoint gets or creates the asking person's DM with a Familiar", async () => {
  const host = await testHost({ person: sam })
  const familiar = String(host.familiar().id)
  const as = (person: Author) =>
    testClient(api(host.workspace(), { authenticate: () => person }))
  const dm = async (person: Author, id = familiar) => {
    const response = await as(person).familiars[':familiar'].dm.$post({
      param: { familiar: id },
    })
    return response.ok ? (await response.json()).room : response.status
  }

  const sams = await dm(sam)
  expect(await dm(sam)).toBe(sams)
  const ann = await dm({ id: 'ann', name: 'Ann' })
  expect(ann).not.toBe(sams)
  expect(await dm(sam, '999')).toBe(404)

  // Each person lists their own DMs and every named room, never others' DMs.
  const kitchen = await host.workspace().rooms.create({
    name: 'Kitchen',
    familiars: [host.familiar().id],
    lead: host.familiar().id,
  })
  const listed = await (await as(sam).rooms.$get()).json()
  expect(listed.map((room) => room.id).sort()).toEqual([sams, kitchen].sort())

  // Nor can anyone else reach a DM, whatever the host allows: it's no such room.
  const ann_ = as({ id: 'ann', name: 'Ann' }).rooms[':room']
  const room = { room: String(sams) }
  expect(
    (await ann_.history.$get({ param: room, query: { before: '1000' } }))
      .status,
  ).toBe(404)
  expect(
    (
      await ann_.messages.$post({
        param: room,
        json: { text: 'Hi Sam', requestId: 'peek' },
      })
    ).status,
  ).toBe(404)
  expect(
    (
      await ann_.notes.$post({
        param: room,
        json: { text: 'Ann joined', requestId: 'peek' },
      })
    ).status,
  ).toBe(404)
  expect((await ann_.events.$get({ param: room })).status).toBe(404)

  // A note to one's own room is accepted.
  expect(
    (
      await as(sam).rooms[':room'].notes.$post({
        param: room,
        json: { text: 'Sam joined', requestId: 'joined' },
      })
    ).status,
  ).toBe(202)
})

test('familiar routes reach that Familiar, and a missing one is 404', async () => {
  const host = await testHost({
    person: sam,
    storage: await storageWith(['Lives in Leeds', 4]),
  })
  const app = api(host.workspace())
  const id = host.familiar().id
  const put = (path: string, body: unknown) =>
    send(app, 'PUT', path, JSON.stringify(body))

  expect(
    (await put(`/familiars/${id}/memory/f1`, { text: 'Lives in York' })).status,
  ).toBe(204)
  const past = await put(`/familiars/${id}/memory/f1`, { text: 'Again' })
  expect(past.status).toBe(404)
  expect(await past.json()).toEqual({
    error: 'f1 is already past; only current facts can change.',
  })
  expect(
    (await put(`/familiars/${id}/memory/f2/pin`, { pinned: 'yes' })).status,
  ).toBe(400)
  expect(
    (await put('/familiars/999/memory/f1', { text: 'Lives in York' })).status,
  ).toBe(404)
  expect((await app.request('/familiars/999/events')).status).toBe(404)
})

test('each stream sends what it is allowed whole first, and 403 when nothing is', async () => {
  const host = await testHost({ person: sam })
  const workspace = host.workspace()
  const familiar = host.familiar().id

  const all = events(await api(workspace).request('/events'))
  await all.until(() => all.names.includes('account'))
  expect(all.names).toEqual([
    'protocol',
    'document familiars',
    'document rooms',
    'document me',
    'account',
  ])
  expect(all.documents.familiars).toEqual({
    familiars: { [familiar]: { name: 'Familiar' } },
  })
  await all.reader.cancel()

  const own = events(
    await api(workspace).request(`/familiars/${familiar}/events`),
  )
  await own.until(() => own.names.length === 5)
  expect(own.names).toEqual([
    'protocol',
    'document model',
    'document memory',
    'document episodes',
    'document schedules',
  ])
  expect(own.documents.model).toMatchObject({
    model: { provider: 'faux', modelId: 'faux-1' },
  })
  await own.reader.cancel()

  const memoryOnly = api(workspace, {
    allow: (_, operation) => operation === 'events.memory',
  })
  const some = events(await memoryOnly.request(`/familiars/${familiar}/events`))
  await some.until(() => some.names.length === 2)
  expect(some.names).toEqual(['protocol', 'document memory'])
  await some.reader.cancel()

  const room = events(
    await api(workspace).request(`/rooms/${host.dm().id}/events`),
  )
  await room.until(() => room.names.length === 3)
  expect(room.names).toEqual(['protocol', 'view', 'document turns'])
  expect(room.documents.turns).toEqual({})
  await room.reader.cancel()

  const none = api(workspace, { allow: () => false })
  expect((await none.request('/events')).status).toBe(403)
})

test("a room's stream shows its own turn's reply as it runs, and only that a Familiar is busy elsewhere", async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  const host = await testHost({
    person: sam,
    plugins: [
      {
        name: 'slow',
        title: 'Slow',
        tools: [
          defineTool({
            name: 'wait',
            description: 'Waits.',
            parameters: Type.Object({}),
            execute: async (_args, api, context) => {
              await api.details({ waiting: 'for the oven' }, context)
              await held
              return { output: [{ type: 'text', text: 'Waited' }] }
            },
          }),
        ],
      },
    ],
  })
  const workspace = host.workspace()
  const id = host.familiar().id
  host.faux.setResponses([
    fauxAssistantMessage(fauxToolCall('wait', {}), { stopReason: 'toolUse' }),
    fauxAssistantMessage('Baked.'),
    fauxAssistantMessage('Hi.'),
  ])
  const kitchen = await workspace.rooms.create({
    name: 'Kitchen',
    familiars: [id],
    lead: id,
  })
  const app = api(workspace)
  const watch = async (room: number) =>
    events(await app.request(`/rooms/${room}/events`))
  const turnsIn = (stream: ReturnType<typeof events>) =>
    Object.values((stream.documents.turns ?? {}) as RoomActivity)

  const there = await watch(kitchen)
  const here = await watch(host.dm().id)
  await post(
    app,
    `/rooms/${kitchen}/messages`,
    JSON.stringify({ text: 'Bake', requestId: 'bake' }),
  )
  await there.until(() =>
    turnsIn(there).some(
      (turn) => turn.status === 'running' && !!turn.tools?.[0]?.details,
    ),
  )
  expect(turnsIn(there)).toMatchObject([
    {
      familiar: id,
      status: 'running',
      tools: [{ name: 'wait', details: { waiting: 'for the oven' } }],
    },
  ])

  await post(
    app,
    `/rooms/${host.dm().id}/messages`,
    JSON.stringify({ text: 'Hello', requestId: 'hello' }),
  )
  await here.until(() => turnsIn(here)[0]?.status === 'elsewhere')
  // Nothing of the Kitchen's run reaches the DM's stream.
  expect(turnsIn(here)).toEqual([
    { familiar: id, cause: expect.any(Number), status: 'elsewhere' },
  ])

  release()
  await here.until(() => turnsIn(here).length === 0)
  await there.until(() => turnsIn(there).length === 0)
  await here.reader.cancel()
  await there.reader.cancel()
})

test('a client leaving stops every watch, even one still opening', async () => {
  const host = await testHost({ person: sam })
  const room = host.dm()
  vi.spyOn(host.workspace().rooms, 'get').mockResolvedValue(room)
  let stopView: ReturnType<typeof vi.fn> | undefined
  const watch = room.watch
  vi.spyOn(room, 'watch').mockImplementation(async () => {
    const view = await watch()
    stopView = vi.spyOn(view, 'stop')
    return view
  })
  let opened!: (watch: WatchHandle<RoomActivity>) => void
  vi.spyOn(room, 'watchTurns').mockReturnValue(
    new Promise((resolve) => (opened = resolve)),
  )

  const stream = events(
    await api(host.workspace()).request(`/rooms/${room.id}/events`),
  )
  await stream.until(() => stream.names.includes('view'))
  await stream.reader.cancel()
  await vi.waitFor(() => expect(stopView).toHaveBeenCalledOnce())

  const stop = vi.fn(async () => ({ reason: 'stopped' as const }))
  const start = vi.fn()
  opened({ value: {}, start, stop, closed: new Promise(() => {}) })
  await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce())
  expect(start).not.toHaveBeenCalled()
})

test('a watch closing ends the stream and stops everything else', async () => {
  const clear = vi.spyOn(globalThis, 'clearInterval')
  const stopAccount = vi.fn()
  const host = await testHost({ person: sam })
  const workspace: Workspace = {
    ...host.workspace(),
    account: {
      state: () => ({ status: 'signed-out' }),
      onChange: () => stopAccount,
    } as unknown as Workspace['account'],
  }
  let close!: () => void
  const stopFamiliars = vi.fn(async () => ({ reason: 'stopped' as const }))
  vi.spyOn(workspace.familiars, 'watch').mockResolvedValue({
    value: { familiars: {} },
    start: vi.fn(),
    stop: stopFamiliars,
    closed: new Promise(
      (resolve) => (close = () => resolve({ reason: 'stopped' })),
    ),
  })

  const stream = events(await api(workspace).request('/events'))
  await stream.until(() => stream.names.includes('account'))
  close()
  while (!(await stream.reader.read()).done) {
    /* Drain until the closed watch ends the response. */
  }
  expect(stopFamiliars).toHaveBeenCalledOnce()
  expect(stopAccount).toHaveBeenCalledOnce()
  expect(clear).toHaveBeenCalled()
  clear.mockRestore()
})

test('push hosts get the authenticated subscriber, whatever the body says', async () => {
  const calls: [string, Author][] = []
  const push: PushHost = {
    publicKey: () => 'key',
    subscribe: async (_, subscriber) =>
      void calls.push(['subscribe', subscriber]),
    unsubscribe: async (_, subscriber) =>
      void calls.push(['unsubscribe', subscriber]),
  }
  const app = api((await testHost({ person: sam })).workspace(), { push })
  const subscription = {
    endpoint: 'https://push.example/alice-phone',
    keys: { p256dh: 'p', auth: 'a' },
    // Sam claims to be someone else.
    subscriber: { id: 'alice', name: 'Alice' },
  }
  const body = JSON.stringify(subscription)
  expect((await post(app, '/push/subscriptions', body)).status).toBe(204)
  expect((await send(app, 'DELETE', '/push/subscriptions', body)).status).toBe(
    204,
  )
  expect(calls).toEqual([
    ['subscribe', sam],
    ['unsubscribe', sam],
  ])
})

// Familiars and rooms can be set up over HTTP, with the rules' refusals as 400s.
test('familiars, rooms and the person asking are created and changed over HTTP', async () => {
  const host = await testHost({ person: sam })
  const client = testClient(api(host.workspace()))
  const created = await client.familiars.$post({
    json: { name: 'Bo', avatar: 'fox' },
  })
  expect(created.status).toBe(201)
  const bo = (await created.json()) as { id: number }
  expect((await client.familiars.$post({ json: { name: ' ' } })).status).toBe(
    400,
  )
  expect(
    (
      await client.familiars[':familiar'].$patch({
        param: { familiar: String(bo.id) },
        json: { persona: 'You are Bo.' },
      })
    ).status,
  ).toBe(204)

  const refused = await client.rooms.$post({
    json: { name: 'Shed', familiars: [bo.id], lead: 999 },
  })
  expect(refused.status).toBe(400)
  const room = await client.rooms.$post({
    json: { name: 'Shed', familiars: [bo.id], lead: bo.id },
  })
  expect(room.status).toBe(201)
  const { id } = (await room.json()) as { id: number }
  // A null lead opens the room.
  expect(
    (
      await client.rooms[':room'].$patch({
        param: { room: String(id) },
        json: { lead: null },
      })
    ).status,
  ).toBe(204)
  expect(
    (await host.workspace().rooms.list()).find((room) => room.id === id),
  ).not.toHaveProperty('lead')
  expect(
    (await client.rooms[':room'].$delete({ param: { room: String(id) } }))
      .status,
  ).toBe(204)
  const closed = await client.rooms[':room'].messages.$post({
    param: { room: String(id) },
    json: { text: 'Hi', requestId: 'r' },
  })
  expect(closed.status).toBe(400)
  // Unarchived, it's open to messages again.
  expect(
    (
      await client.rooms[':room'].$patch({
        param: { room: String(id) },
        json: { archived: false },
      })
    ).status,
  ).toBe(204)
  const reopened = await client.rooms[':room'].messages.$post({
    param: { room: String(id) },
    json: { text: 'Hi', requestId: 'r' },
  })
  expect(reopened.status).toBe(202)
  expect(await host.workspace().familiars.list()).toContainEqual({
    id: bo.id,
    name: 'Bo',
    persona: 'You are Bo.',
    avatar: 'fox',
  })

  // Whoever asks may change what Familiars call them.
  expect((await client.me.$patch({ json: { name: ' ' } })).status).toBe(400)
  expect((await client.me.$patch({ json: { name: 'Samuel' } })).status).toBe(
    204,
  )
  expect(await (await client.me.$get()).json()).toEqual({
    id: 'sam',
    name: 'Samuel',
  })
})
