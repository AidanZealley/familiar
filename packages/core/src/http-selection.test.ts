import { createModels } from '@earendil-works/pi-ai/models'
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux'
import { MemoryStorage } from '@earendil-works/pi-durable'
import { Hono } from 'hono'
import { hc } from 'hono/client'
import type { BlankSchema, ExtractSchema } from 'hono/types'
import { afterEach, expect, expectTypeOf, test, vi } from 'vitest'
import type { AccountApi } from './account/index.ts'
import type { Author } from './conversation/message.ts'
import {
  authorizeSingleOwner,
  summonFamiliar,
  type Familiar,
} from './familiar.ts'
import { guarded } from './http-guard.ts'
import {
  accountOperations,
  conversationOperations,
  createHttpApi,
  type HttpApi,
  type HttpRoutes,
  type PushHost,
} from './http.ts'

const opened: Familiar[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((familiar) => familiar.dismiss()))
})

async function summon() {
  const models = createModels()
  models.setProvider(fauxProvider().provider)
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    timeZone: 'UTC',
    authorizeTool: authorizeSingleOwner,
  })
  opened.push(familiar)
  return familiar
}

const sam: Author = { id: 'sam', name: 'Sam' }
const authenticate = () => sam

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

// One request to every route the full API serves, each harmless when it runs.
const everyRoute: [string, string, RequestInit?][] = [
  ['GET', '/history?before=1'],
  ['POST', '/abort'],
  ['GET', '/model/options'],
  ['GET', '/account'],
  ['GET', '/memory/health'],
  ['DELETE', '/schedules/none'],
  ['GET', '/push/key'],
  ['GET', '/connections'],
  ['POST', '/mcp/none/reconnect'],
  ['POST', '/messages', json('POST', { text: 'Hi', requestId: 'r' })],
  ['PUT', '/memory/f1', json('PUT', { text: 'Changed' })],
  [
    'POST',
    '/mcp',
    json('POST', {
      name: 'x',
      transport: { type: 'http', url: 'https://example.com' },
    }),
  ],
]

test('no routes are served unless chosen', async () => {
  const familiar = await summon()
  const send = vi.spyOn(familiar, 'send')
  const add = vi.spyOn(familiar.mcp, 'add')
  const watch = vi.spyOn(familiar, 'watch')
  for (const api of [
    createHttpApi(familiar, { authenticate }),
    createHttpApi(familiar, { authenticate, routes: {} }),
    createHttpApi(familiar, { authenticate, routes: { events: {} } }),
  ]) {
    for (const [method, path, init] of [
      ...everyRoute,
      ['GET', '/events'] as const,
    ]) {
      const response = await api.request(path, { method, ...init })
      expect(response.status, `${method} ${path}`).toBe(404)
    }
  }
  expect(send).not.toHaveBeenCalled()
  expect(add).not.toHaveBeenCalled()
  expect(watch).not.toHaveBeenCalled()
})

test('only the chosen operations are mounted', async () => {
  const familiar = await summon()
  const add = vi.spyOn(familiar.mcp, 'add')
  const api = createHttpApi(familiar, {
    authenticate,
    routes: { conversation: { history: true }, memory: { health: true } },
  })
  expect((await api.request('/history?before=1')).status).toBe(200)
  expect((await api.request('/memory/health')).status).toBe(200)
  for (const [method, path, init] of everyRoute.filter(
    ([, path]) => !path.startsWith('/history') && path !== '/memory/health',
  )) {
    const response = await api.request(path, { method, ...init })
    expect(response.status, `${method} ${path}`).toBe(404)
  }
  expect((await api.request('/events')).status).toBe(404)
  expect(add).not.toHaveBeenCalled()
})

test('each operation asks only its own check, and a refusal changes nothing', async () => {
  const familiar = await summon()
  const send = vi.spyOn(familiar, 'send')
  const abort = vi.spyOn(familiar, 'abort')
  const push: PushHost = {
    publicKey: () => 'key',
    subscribe: vi.fn(async () => {}),
    unsubscribe: vi.fn(async () => {}),
  }
  const subscribe = vi.fn(() => false)
  const unsubscribe = vi.fn(() => true)
  const sendCheck = vi.fn(async () => false)
  const abortCheck = vi.fn(() => true)
  const api = createHttpApi(familiar, {
    authenticate,
    push,
    routes: {
      conversation: { send: sendCheck, abort: abortCheck, history: true },
      memory: { health: true },
      push: { subscribe, unsubscribe },
    },
  })
  const subscription = {
    endpoint: 'https://push.example/one',
    keys: { p256dh: 'p', auth: 'a' },
  }

  // Unrelated and unselected routes ask no check.
  expect((await api.request('/history?before=1')).status).toBe(200)
  expect((await api.request('/memory/health')).status).toBe(200)
  expect((await api.request('/push/key')).status).toBe(404)
  for (const check of [sendCheck, abortCheck, subscribe, unsubscribe]) {
    expect(check).not.toHaveBeenCalled()
  }

  // Refused before the handler: nothing is sent.
  const refused = await api.request(
    '/messages',
    json('POST', { text: 'Hi', requestId: 'r' }),
  )
  expect(refused.status).toBe(403)
  expect(sendCheck).toHaveBeenCalledExactlyOnceWith(sam, expect.any(Request))
  expect(send).not.toHaveBeenCalled()
  // A sibling at the same mount keeps its own answer.
  expect((await api.request('/abort', { method: 'POST' })).status).toBe(202)
  expect(abortCheck).toHaveBeenCalledOnce()
  expect(abort).toHaveBeenCalledOnce()
  expect(sendCheck).toHaveBeenCalledOnce()

  // One path, two methods, two checks.
  const post = await api.request(
    '/push/subscriptions',
    json('POST', subscription),
  )
  expect(post.status).toBe(403)
  expect(subscribe).toHaveBeenCalledOnce()
  expect(unsubscribe).not.toHaveBeenCalled()
  expect(push.subscribe).not.toHaveBeenCalled()
  const remove = await api.request(
    '/push/subscriptions',
    json('DELETE', subscription),
  )
  expect(remove.status).toBe(204)
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(subscribe).toHaveBeenCalledOnce()
  expect(push.unsubscribe).toHaveBeenCalledOnce()
})

test('authentication, then the body limit, come before any check', async () => {
  const familiar = await summon()
  const send = vi.spyOn(familiar, 'send')
  const check = vi.fn(() => true)
  const routes = { conversation: { send: check } }
  const message = json('POST', { text: 'Hello there', requestId: 'r' })

  const anonymous = createHttpApi(familiar, {
    authenticate: () => undefined,
    routes,
  })
  expect((await anonymous.request('/messages', message)).status).toBe(401)
  // Unchosen routes ask for authentication too, as before.
  expect((await anonymous.request('/mcp', { method: 'POST' })).status).toBe(401)
  expect(check).not.toHaveBeenCalled()

  const small = createHttpApi(familiar, {
    authenticate,
    routes,
    maxBodySize: 16,
  })
  expect((await small.request('/messages', message)).status).toBe(413)
  expect(check).not.toHaveBeenCalled()
  expect(send).not.toHaveBeenCalled()
})

test('a check guards its own route even where another pattern also matches', async () => {
  const cancel = vi.fn()
  const clear = vi.fn()
  const items = {
    // `/items/:id` also matches `/items/all`.
    cancel: new Hono().delete('/items/:id', (c) => {
      cancel(c.req.param('id'))
      return c.body(null, 204)
    }),
    clear: new Hono().delete('/items/all', (c) => {
      clear()
      return c.body(null, 204)
    }),
  }
  const api = (order: ('cancel' | 'clear')[], refused: 'cancel' | 'clear') => {
    const app = new Hono<{ Variables: { author: Author } }>().use(
      async (c, next) => {
        c.set('author', sam)
        await next()
      },
    )
    for (const name of order) {
      app.route(
        '/',
        guarded(items[name], name === refused ? () => false : true),
      )
    }
    return app
  }
  const remove = (app: { request: Hono['request'] }, path: string) =>
    app.request(path, { method: 'DELETE' })

  // Whichever route matches first runs only past its own check, and a
  // refusal never falls through to the other route's handler.
  expect(
    (await remove(api(['cancel', 'clear'], 'cancel'), '/items/all')).status,
  ).toBe(403)
  expect(
    (await remove(api(['clear', 'cancel'], 'clear'), '/items/all')).status,
  ).toBe(403)
  expect(cancel).not.toHaveBeenCalled()
  expect(clear).not.toHaveBeenCalled()
  expect(
    (await remove(api(['clear', 'cancel'], 'clear'), '/items/3')).status,
  ).toBe(204)
  expect(cancel).toHaveBeenCalledExactlyOnceWith('3')
  expect(clear).not.toHaveBeenCalled()

  // An operation is one method and path, so its check can't cover others.
  expect(() =>
    guarded(
      new Hono().use(async (_c, next) => next()),
      () => true,
    ),
  ).toThrow('one method and path')
  expect(() =>
    guarded(
      new Hono().get('/a', (c) => c.body(null)).get('/b', (c) => c.body(null)),
      () => true,
    ),
  ).toThrow('one method and path')
})

/** The events a stream sends within `ms` of opening, and its whole text. */
async function stream(api: { request: Hono['request'] }, ms = 100) {
  const response = await api.request('/events')
  expect(response.status).toBe(200)
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  let text = ''
  const deadline = new Promise<undefined>((resolve) =>
    setTimeout(() => resolve(undefined), ms),
  )
  for (;;) {
    const chunk = await Promise.race([reader.read(), deadline])
    if (!chunk || chunk.done) {
      break
    }
    text += chunk.value
  }
  await reader.cancel()
  const events = [...text.matchAll(/^event: (.+)\ndata: (.+)$/gm)].map(
    ([, event, data]) =>
      event === 'document' ? `document ${JSON.parse(data).name}` : event,
  )
  return { events, text }
}

test('each event source is chosen and checked on its own as a stream connects', async () => {
  const summoned = await summon()
  const state = vi.fn(() => ({
    status: 'signing-in' as const,
    url: 'https://login.example/device',
    code: 'WXYZ-1234',
  }))
  const onChange = vi.fn(() => () => {})
  const account = { state, onChange } as unknown as AccountApi
  const familiar: Familiar = { ...summoned, account }
  const watchMemory = vi.spyOn(familiar.memory, 'watch')
  const watchSchedules = vi.spyOn(familiar.schedules, 'watch')
  const owner = vi.fn((author: Author) => author.id === 'owner')

  // Account routes don't stream the account, and refused sources open nothing.
  const member = createHttpApi(familiar, {
    authenticate,
    routes: {
      account: { state: owner, signIn: owner },
      events: {
        conversation: true,
        schedules: true,
        memory: owner,
        account: owner,
      },
    },
  })
  const seen = await stream(member)
  expect(seen.events).toEqual(['protocol', 'view', 'document schedules'])
  expect(seen.text).not.toContain('login.example')
  expect(seen.text).not.toContain('WXYZ')
  expect(owner).toHaveBeenCalledTimes(2)
  expect(watchMemory).not.toHaveBeenCalled()
  expect(state).not.toHaveBeenCalled()
  expect(onChange).not.toHaveBeenCalled()
  expect(watchSchedules).toHaveBeenCalledOnce()

  // The same API streams the owner everything it chose.
  const asOwner = createHttpApi(familiar, {
    authenticate: () => ({ id: 'owner', name: 'Owner' }),
    routes: { events: { conversation: true, memory: owner, account: owner } },
  })
  const theirs = await stream(asOwner)
  expect(theirs.events).toEqual([
    'protocol',
    'view',
    'document memory',
    'account',
  ])
  expect(theirs.text).toContain('login.example')

  // Refused every chosen source, a stream is refused.
  const refused = createHttpApi(familiar, {
    authenticate,
    routes: { events: { account: owner } },
  })
  expect((await refused.request('/events')).status).toBe(403)

  // `true` is every source.
  const all = createHttpApi(familiar, {
    authenticate,
    routes: { events: true },
  })
  expect((await stream(all)).events).toEqual([
    'protocol',
    'view',
    'document memory',
    'document episodes',
    'document schedules',
    'account',
  ])
})

test('selections other than true or named routes are refused at construction', async () => {
  const familiar = await summon()
  for (const routes of [
    false,
    'all',
    null,
    [],
    { conversaton: { send: true } },
    { conversation: true },
    { conversation: { send: false } },
    { conversation: { send: 'yes' } },
    { conversation: { sned: true } },
    { conversation: { history: true, toString: true } },
    { account: { signIn: true, cancel: true } },
    { events: false },
    { events: { conversation: true, acount: true } },
    { events: { account: 1 } },
  ]) {
    expect(
      () => createHttpApi(familiar, { authenticate, routes: routes as never }),
      JSON.stringify(routes),
    ).toThrow(TypeError)
  }
})

test('`true` serves every operation and source', async () => {
  const familiar = await summon()
  const api = createHttpApi(familiar, { authenticate, routes: true })
  for (const [method, path, init] of everyRoute.filter(([, , init]) => !init)) {
    const response = await api.request(path, { method, ...init })
    expect(response.status, `${method} ${path}`).not.toBe(403)
  }
  expect((await stream(api)).events).toContain('account')
})

// Compile-time checks; the test only keeps them in the suite.
const selectionTypes = (familiar: Familiar) => {
  expectTypeOf<keyof NonNullable<HttpRoutes['conversation']>>().toEqualTypeOf<
    | 'send'
    | 'history'
    | 'abort'
    | 'modelOptions'
    | 'setModel'
    | 'setThinkingLevel'
  >()
  expectTypeOf<keyof NonNullable<HttpRoutes['account']>>().toEqualTypeOf<
    'state' | 'signIn' | 'answerSignIn' | 'cancelSignIn' | 'signOut'
  >()
  expectTypeOf<keyof HttpRoutes>().toEqualTypeOf<
    | 'conversation'
    | 'account'
    | 'memory'
    | 'schedules'
    | 'push'
    | 'connections'
    | 'mcp'
    | 'events'
  >()

  // A selection is exactly its routes, as composing them by hand gives.
  const sendOnly = createHttpApi(familiar, {
    authenticate,
    routes: { conversation: { send: true } },
  })
  const handMade = new Hono().route(
    '/',
    conversationOperations(familiar, () => sam).send,
  )
  expectTypeOf<ExtractSchema<typeof sendOnly>>().toEqualTypeOf<{
    '/messages': ExtractSchema<typeof handMade>['/messages']
  }>()
  // @ts-expect-error a precise schema, not any
  const anySchema: ExtractSchema<typeof sendOnly> = 1

  // Same path, different methods: both, merged, with typed inputs.
  const signIn = createHttpApi(familiar, {
    authenticate,
    // Checks get the authenticated author and request.
    routes: {
      account: {
        signIn: (author) => author.id === 'owner',
        cancelSignIn: async (_author, request) => request.method === 'DELETE',
        answerSignIn: true,
      },
    },
  })
  const account = hc<typeof signIn>('/').account
  account['sign-in'].$post()
  account['sign-in'].$delete()
  account['sign-in'].answer.$post({ json: { text: 'https://back.example' } })
  // @ts-expect-error inputs stay typed
  account['sign-in'].answer.$post({ json: { text: 1 } })
  // @ts-expect-error unselected
  account['sign-out'].$post()
  // @ts-expect-error unselected
  account.$get()
  const accountOnly = new Hono().route(
    '/account',
    accountOperations(undefined).signIn,
  )
  expectTypeOf<
    ExtractSchema<typeof signIn>['/account/sign-in']['$post']
  >().toEqualTypeOf<
    ExtractSchema<typeof accountOnly>['/account/sign-in']['$post']
  >()

  // No routes, and no stream without a source.
  const none = createHttpApi(familiar, { authenticate })
  expectTypeOf<ExtractSchema<typeof none>>().toEqualTypeOf<BlankSchema>()
  const empty = createHttpApi(familiar, {
    authenticate,
    routes: { events: {} },
  })
  // @ts-expect-error no sources, no stream
  hc<typeof empty>('/').events.$get()
  const events = createHttpApi(familiar, {
    authenticate,
    routes: { events: { account: true } },
  })
  hc<typeof events>('/').events.$get()
  expectTypeOf(
    createHttpApi(familiar, { authenticate, routes: true }),
  ).toEqualTypeOf<HttpApi>()

  createHttpApi(familiar, {
    authenticate,
    // @ts-expect-error misspelled operation
    routes: { conversation: { send: true, sned: true } },
  })
  createHttpApi(familiar, {
    authenticate,
    // @ts-expect-error unknown group
    routes: { conversation: { send: true }, memroy: { health: true } },
  })
  createHttpApi(familiar, {
    authenticate,
    // @ts-expect-error false isn't a selection
    routes: { conversation: { send: false } },
  })
  createHttpApi(familiar, {
    authenticate,
    // @ts-expect-error no group-wide shorthand
    routes: { conversation: true },
  })
  createHttpApi(familiar, {
    authenticate,
    // @ts-expect-error unknown event source
    routes: { events: { conversation: true, acount: true } },
  })
  createHttpApi(familiar, {
    authenticate,
    // @ts-expect-error checks return a boolean
    routes: { memory: { health: () => 'yes' } },
  })
  // Values above exist for their types.
  return [
    anySchema,
    sendOnly,
    handMade,
    signIn,
    accountOnly,
    none,
    empty,
    events,
  ]
}

test('selections type exactly what they mount', () => {
  expect(selectionTypes).toBeTypeOf('function')
})
