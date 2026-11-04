import type { Hono } from 'hono'
import { expect, test, vi } from 'vitest'
import type { Author } from '../conversation/message.ts'
import { createHttpApi, type PushHost } from './index.ts'
import { testFamiliar } from '../testing.ts'

const sam: Author = { id: 'sam', name: 'Sam' }
const authenticate = () => sam

type Api = { request: Hono['request'] }
type Call = [method: string, path: string, body?: unknown]

const call = (api: Api, [method, path, body]: Call) =>
  api.request(
    path,
    body === undefined
      ? { method }
      : {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  )

// One request to every route the full API serves, each harmless when it runs.
const everyRoute: Call[] = [
  ['GET', '/history?before=1'],
  ['POST', '/abort'],
  ['GET', '/model/options'],
  ['GET', '/account'],
  ['GET', '/memory/health'],
  ['DELETE', '/schedules/none'],
  ['GET', '/push/key'],
  ['GET', '/connections'],
  ['POST', '/mcp/none/reconnect'],
  ['POST', '/messages', { text: 'Hi', requestId: 'r' }],
  ['PUT', '/memory/f1', { text: 'Changed' }],
  [
    'POST',
    '/mcp',
    { name: 'x', transport: { type: 'http', url: 'https://example.com' } },
  ],
]

/** Each call's status, by `METHOD /path`, made one after another. */
async function statuses(api: Api, calls: Call[]) {
  const answered: Record<string, number> = {}
  for (const each of calls) {
    answered[`${each[0]} ${each[1]}`] = (await call(api, each)).status
  }
  return answered
}

const every = (calls: Call[], status: number) =>
  Object.fromEntries(
    calls.map(([method, path]) => [`${method} ${path}`, status]),
  )

test('no routes are served unless chosen', async () => {
  const familiar = await testFamiliar()
  const spies = [
    vi.spyOn(familiar, 'send'),
    vi.spyOn(familiar.mcp, 'add'),
    vi.spyOn(familiar, 'watch'),
  ]
  const calls: Call[] = [...everyRoute, ['GET', '/events']]
  for (const routes of [undefined, {}, { events: {} }]) {
    const api = createHttpApi(familiar, { authenticate, routes })
    expect(await statuses(api, calls)).toEqual(every(calls, 404))
  }
  for (const spy of spies) {
    expect(spy).not.toHaveBeenCalled()
  }
})

test('only the chosen operations are mounted', async () => {
  const familiar = await testFamiliar()
  const add = vi.spyOn(familiar.mcp, 'add')
  const api = createHttpApi(familiar, {
    authenticate,
    routes: { conversation: { history: true }, memory: { health: true } },
  })
  expect(await statuses(api, [...everyRoute, ['GET', '/events']])).toEqual({
    ...every(everyRoute, 404),
    'GET /events': 404,
    'GET /history?before=1': 200,
    'GET /memory/health': 200,
  })
  expect(add).not.toHaveBeenCalled()
})

test('each operation asks only its own check, and a refusal changes nothing', async () => {
  const familiar = await testFamiliar()
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
  expect((await call(api, ['GET', '/history?before=1'])).status).toBe(200)
  expect((await call(api, ['GET', '/memory/health'])).status).toBe(200)
  expect((await call(api, ['GET', '/push/key'])).status).toBe(404)
  for (const check of [sendCheck, abortCheck, subscribe, unsubscribe]) {
    expect(check).not.toHaveBeenCalled()
  }

  // Refused before the handler: nothing is sent.
  const message: Call = ['POST', '/messages', { text: 'Hi', requestId: 'r' }]
  expect((await call(api, message)).status).toBe(403)
  expect(sendCheck).toHaveBeenCalledExactlyOnceWith(sam, expect.any(Request))
  expect(send).not.toHaveBeenCalled()
  // A sibling at the same mount keeps its own answer.
  expect((await call(api, ['POST', '/abort'])).status).toBe(202)
  expect(abortCheck).toHaveBeenCalledOnce()
  expect(abort).toHaveBeenCalledOnce()
  expect(sendCheck).toHaveBeenCalledOnce()

  // One path, two methods, two checks.
  const post: Call = ['POST', '/push/subscriptions', subscription]
  expect((await call(api, post)).status).toBe(403)
  expect(subscribe).toHaveBeenCalledOnce()
  expect(unsubscribe).not.toHaveBeenCalled()
  expect(push.subscribe).not.toHaveBeenCalled()
  const remove: Call = ['DELETE', '/push/subscriptions', subscription]
  expect((await call(api, remove)).status).toBe(204)
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(subscribe).toHaveBeenCalledOnce()
  expect(push.unsubscribe).toHaveBeenCalledOnce()
})

test('authentication, then the body limit, come before any check', async () => {
  const familiar = await testFamiliar()
  const send = vi.spyOn(familiar, 'send')
  const check = vi.fn(() => true)
  const routes = { conversation: { send: check } }
  const message: Call = [
    'POST',
    '/messages',
    { text: 'Hello there', requestId: 'r' },
  ]

  const anonymous = createHttpApi(familiar, {
    authenticate: () => undefined,
    routes,
  })
  expect((await call(anonymous, message)).status).toBe(401)
  // Unchosen routes ask for authentication too, as before.
  expect((await call(anonymous, ['POST', '/mcp'])).status).toBe(401)
  expect(check).not.toHaveBeenCalled()

  const small = createHttpApi(familiar, {
    authenticate,
    routes,
    maxBodySize: 16,
  })
  expect((await call(small, message)).status).toBe(413)
  expect(check).not.toHaveBeenCalled()
  expect(send).not.toHaveBeenCalled()
})

test('selections other than true or named routes are refused at construction', async () => {
  const familiar = await testFamiliar()
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

test('`true` serves every operation', async () => {
  const familiar = await testFamiliar()
  const api = createHttpApi(familiar, { authenticate, routes: true })
  const answered = await statuses(
    api,
    everyRoute.filter(([, , body]) => body === undefined),
  )
  expect(Object.keys(answered)).toHaveLength(9)
  expect(
    Object.entries(answered).filter(([, status]) => status === 403),
  ).toEqual([])
})
