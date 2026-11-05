import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux'
import type { DocumentWatch } from '@earendil-works/pi-durable'
import { testClient } from 'hono/testing'
import { expect, test, vi } from 'vitest'
import type { Author } from '../conversation/message.ts'
import { MESSAGE_LIMITS, type Familiar } from '../familiar.ts'
import { storageWith } from '../memory/testing.ts'
import { fauxModels, testFamiliar } from '../testing.ts'
import {
  createHttpApi,
  DEFAULT_MAX_BODY_SIZE,
  type Allow,
  type FactsState,
  type HttpOptions,
  type Operation,
  type PushHost,
} from './index.ts'

const sam: Author = { id: 'sam', name: 'Sam' }

const api = (familiar: Familiar, options: Partial<HttpOptions> = {}) =>
  createHttpApi(familiar, {
    authenticate: () => sam,
    allow: () => true,
    ...options,
  })

const post = (
  app: {
    request(path: string, init: RequestInit): Promise<Response> | Response
  },
  path: string,
  body: BodyInit,
  headers: Record<string, string> = {},
) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    duplex: 'half',
  } as RequestInit)

/** Reads a stream's events until `until` has arrived. */
async function events(response: Response, until: string) {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  let text = ''
  while (!text.includes(`event: ${until}\n`)) {
    const chunk = await reader.read()
    expect(chunk.done).toBe(false)
    text += chunk.value
  }
  const names = [...text.matchAll(/^event: (.+)\ndata: (.+)$/gm)].map(
    ([, event, data]) =>
      event === 'document' ? `document ${JSON.parse(data).name}` : event,
  )
  return { names, reader }
}

test('a request is authenticated, then bounded, then allowed, before any route reads it', async () => {
  const familiar = await testFamiliar()
  const send = vi.spyOn(familiar, 'send')
  const allow = vi.fn<Allow>(
    (_, operation) => operation !== 'conversation.send',
  )
  const app = api(familiar, {
    authenticate: (request) =>
      request.headers.get('x-person') === 'sam' ? sam : undefined,
    allow,
  })
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

  expect((await post(app, '/messages', message)).status).toBe(401)
  expect(
    (await post(app, '/messages', huge, { 'x-person': 'sam' })).status,
  ).toBe(413)
  expect(
    (await post(app, '/messages', streamed, { 'x-person': 'sam' })).status,
  ).toBe(413)
  expect(allow).not.toHaveBeenCalled()

  expect(
    (await post(app, '/messages', message, { 'x-person': 'sam' })).status,
  ).toBe(403)
  expect(allow).toHaveBeenCalledWith(sam, 'conversation.send')
  expect(send).not.toHaveBeenCalled()
})

// Every route and the one operation it asks about. Keyed by Operation, so
// an operation added without a route here is a type error.
const ROUTES = {
  'conversation.history': ['GET', '/history?before=1'],
  'conversation.send': ['POST', '/messages'],
  'conversation.abort': ['POST', '/abort'],
  'conversation.modelOptions': ['GET', '/model/options'],
  'conversation.setModel': ['PUT', '/model'],
  'conversation.setThinkingLevel': ['PUT', '/model/thinking-level'],
  'account.state': ['GET', '/account'],
  'account.signIn': ['POST', '/account/sign-in'],
  'account.answerSignIn': ['POST', '/account/sign-in/answer'],
  'account.cancelSignIn': ['DELETE', '/account/sign-in'],
  'account.signOut': ['POST', '/account/sign-out'],
  'memory.revise': ['PUT', '/memory/f1'],
  'memory.retire': ['POST', '/memory/f1/retire'],
  'memory.setPinned': ['PUT', '/memory/f1/pin'],
  'schedules.cancel': ['DELETE', '/schedules/s1'],
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
} satisfies Record<
  Exclude<Operation, `events.${string}`>,
  [method: string, path: string]
>

test('each route asks about its own operation alone, and is refused before it runs', async () => {
  const asked: Operation[] = []
  const app = api(await testFamiliar(), {
    allow: (_, operation) => {
      asked.push(operation)
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
      [operation],
    ])
  }

  asked.length = 0
  expect((await app.request('/events')).status).toBe(403)
  expect(asked).toEqual([
    'events.conversation',
    'events.memory',
    'events.episodes',
    'events.schedules',
    'events.account',
  ])
})

test('messages and history validate what clients send, and the author comes from the host', async () => {
  const { faux, models } = fauxModels()
  const familiar = await testFamiliar({ models })
  faux.setResponses([fauxAssistantMessage('Hello.')])
  const client = testClient(api(familiar))

  const sent = await post(
    api(familiar),
    '/messages',
    JSON.stringify({
      text: 'Hi',
      requestId: 'hi',
      author: { id: 'x', name: 'Spoofed' },
    }),
  )
  expect(sent.status).toBe(202)
  await familiar.idle()

  for (const text of [' ', 'x'.repeat(MESSAGE_LIMITS.text + 1)]) {
    const refused = await client.messages.$post({
      json: { text, requestId: 'r' },
    })
    expect(refused.status).toBe(400)
  }
  expect(
    (await client.history.$get({ query: { before: 'latest' } })).status,
  ).toBe(400)

  const response = await client.history.$get({
    query: { before: String(Number.MAX_SAFE_INTEGER) },
  })
  if (!response.ok) {
    throw new Error(`history failed: ${response.status}`)
  }
  const page = await response.json()
  expect(page.entries.map((entry) => entry.kind)).toEqual([
    'pi.assistant',
    'pi.system',
    'familiar.message',
  ])
  expect(page.entries[2].data).toEqual({ author: sam, text: 'Hi' })
})

test('memory routes edit facts and refuse missing or past ones', async () => {
  const familiar = await testFamiliar({
    storage: await storageWith(['Lives in Leeds', 4]),
  })
  const app = api(familiar)
  const put = (path: string, body: unknown) =>
    app.request(path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  expect((await put('/memory/f1', { text: 'Lives in York' })).status).toBe(204)
  const past = await put('/memory/f1', { text: 'Again' })
  expect(past.status).toBe(404)
  expect(await past.json()).toEqual({
    error: 'f1 is already past; only current facts can change.',
  })
  expect((await put('/memory/f2/pin', { pinned: 'yes' })).status).toBe(400)
})

test('the stream sends each allowed source whole first, and 403 when none is', async () => {
  const familiar = await testFamiliar()
  const watchMemory = vi.spyOn(familiar.memory, 'watch')

  const all = await events(await api(familiar).request('/events'), 'account')
  expect(all.names).toEqual([
    'protocol',
    'view',
    'document memory',
    'document episodes',
    'document schedules',
    'account',
  ])
  await all.reader.cancel()
  watchMemory.mockClear()

  const chat = api(familiar, {
    allow: (_, operation) => operation === 'events.conversation',
  })
  const some = await events(await chat.request('/events'), 'view')
  expect(some.names).toEqual(['protocol', 'view'])
  await some.reader.cancel()
  expect(watchMemory).not.toHaveBeenCalled()

  const none = api(familiar, { allow: () => false })
  expect((await none.request('/events')).status).toBe(403)
})

test('a client leaving stops every watch, even one still opening', async () => {
  const familiar = await testFamiliar()
  let stopView: ReturnType<typeof vi.fn> | undefined
  const watch = familiar.watch
  vi.spyOn(familiar, 'watch').mockImplementation(async () => {
    const view = await watch()
    stopView = vi.spyOn(view, 'stop')
    return view
  })
  let opened!: (watch: DocumentWatch<FactsState>) => void
  vi.spyOn(familiar.memory, 'watch').mockReturnValue(
    new Promise((resolve) => (opened = resolve)),
  )

  const { reader } = await events(
    await api(familiar).request('/events'),
    'view',
  )
  await reader.cancel()
  await vi.waitFor(() => expect(stopView).toHaveBeenCalledOnce())

  const stop = vi.fn(async () => ({ reason: 'stopped' as const }))
  const start = vi.fn()
  opened({ value: null, start, stop, closed: new Promise(() => {}) })
  await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce())
  expect(start).not.toHaveBeenCalled()
})

test('a watch closing ends the stream and stops everything else', async () => {
  const clear = vi.spyOn(globalThis, 'clearInterval')
  const stopAccount = vi.fn()
  const familiar: Familiar = {
    ...(await testFamiliar()),
    account: {
      state: () => ({ status: 'signed-out' }),
      onChange: () => stopAccount,
    } as unknown as Familiar['account'],
  }
  let close!: () => void
  const stopMemory = vi.fn(async () => ({ reason: 'stopped' as const }))
  vi.spyOn(familiar.memory, 'watch').mockResolvedValue({
    value: null,
    start: vi.fn(),
    stop: stopMemory,
    closed: new Promise(
      (resolve) => (close = () => resolve({ reason: 'stopped' })),
    ),
  })

  const { reader } = await events(
    await api(familiar).request('/events'),
    'account',
  )
  close()
  while (!(await reader.read()).done) {
    /* Drain until the closed watch ends the response. */
  }
  expect(stopMemory).toHaveBeenCalledOnce()
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
  const app = api(await testFamiliar(), { push })
  const subscription = {
    endpoint: 'https://push.example/alice-phone',
    keys: { p256dh: 'p', auth: 'a' },
    // Sam claims to be someone else.
    subscriber: { id: 'alice', name: 'Alice' },
  }
  const body = JSON.stringify(subscription)
  expect((await post(app, '/push/subscriptions', body)).status).toBe(204)
  expect(
    (
      await app.request('/push/subscriptions', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body,
      })
    ).status,
  ).toBe(204)
  expect(calls).toEqual([
    ['subscribe', sam],
    ['unsubscribe', sam],
  ])
})
