import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createFamiliarStore } from './store.ts'
import type { FamiliarStore } from './store.ts'
import { entry, frame, testServer, view } from './testing.ts'

// The page the client runs in, which relative URLs such as `/api` resolve against.
beforeEach(() => {
  vi.stubGlobal('document', { baseURI: 'http://familiar.test/chat' })
})

const opened: FamiliarStore[] = []
afterEach(() => {
  opened.splice(0).forEach((store) => store.disconnect())
  vi.unstubAllGlobals()
})

const open = (
  ...[baseUrl, options]: Parameters<typeof createFamiliarStore>
) => {
  const store = createFamiliarStore(baseUrl, options)
  opened.push(store)
  return store
}

// History before entry n is entry n - 1, back to entry 1.
const history = (request: Request) => {
  const before = Number(new URL(request.url).searchParams.get('before'))
  const entries = before > 1 ? [entry(before - 1)] : []
  return Response.json({ entries, more: before - 1 > 1 })
}

test('loadOlder pages back to the start, one request at a time', async () => {
  const server = testServer(history)
  const store = open('/api', { fetch: server.fetch })
  await expect.poll(server.connections).toBe(1)
  server.send(frame('view', view(3)))
  await expect.poll(() => store.getState().connection).toBe('open')
  const { loadOlder } = store.conversation

  const first = loadOlder()
  expect(store.getState().history.status).toBe('loading')
  // A second call while loading sends nothing.
  await loadOlder()
  await first
  await loadOlder()
  // At the start, nothing more is asked for.
  await loadOlder()

  expect(
    server.requests
      .map((request) => request.url)
      .filter((url) => url.includes('/history')),
  ).toEqual([
    'http://familiar.test/api/history?before=3',
    'http://familiar.test/api/history?before=2',
  ])
  expect(store.getState().history).toEqual({
    entries: [entry(1), entry(2)],
    status: 'start',
  })
  expect(store.getState().view?.entries).toEqual([entry(3)])
})

test('account and documents arrive whole, take patches and can be null', async () => {
  const server = testServer()
  const store = open('/api', { fetch: server.fetch })
  await expect.poll(server.connections).toBe(1)
  expect(store.getState().account).toBeUndefined()

  server.send(frame('account', null))
  server.send(
    frame('document', { name: 'memory', value: { facts: [], next: 1 } }),
  )
  server.send(frame('document', { name: 'schedules', value: {} }))
  server.send(
    frame('document.ops', { name: 'memory', ops: [['s', ['next'], 2]] }),
  )
  server.send(frame('document', { name: 'schedules', value: null }))

  await expect.poll(() => store.getState().schedules).toBeNull()
  expect(store.getState()).toMatchObject({
    account: null,
    memory: { facts: [], next: 2 },
    episodes: undefined,
  })
})

test('a refused or failed command rejects once and is never sent again', async () => {
  let status = 401
  const server = testServer(() =>
    status === 401
      ? Response.json({ error: 'unauthorized' }, { status })
      : new Response(null, { status }),
  )
  const store = open('/api', { fetch: server.fetch })
  await expect.poll(server.connections).toBe(1)
  server.send(frame('view', view(1)))
  await expect.poll(() => store.getState().connection).toBe('open')

  await expect(store.conversation.send('Hello')).rejects.toThrow('unauthorized')
  status = 503
  await expect(store.conversation.abort()).rejects.toThrow('503')

  expect(
    server.requests
      .filter((request) => request.method === 'POST')
      .map((request) => new URL(request.url).pathname),
  ).toEqual(['/api/messages', '/api/abort'])
  // A command's failure says nothing about the stream.
  expect(store.getState().connection).toBe('open')
})

test('without a fetch option the store uses the global fetch for the stream and commands', async () => {
  const server = testServer()
  vi.stubGlobal('fetch', server.fetch)
  const store = open('http://familiar.test/api')
  await expect.poll(server.connections).toBe(1)
  server.send(frame('view', view(1)))
  await expect.poll(() => store.getState().connection).toBe('open')
  await store.conversation.send('Hello')

  expect(server.requests.map((request) => request.url)).toEqual([
    'http://familiar.test/api/events',
    'http://familiar.test/api/messages',
  ])
})

const message = (id: number) => ({
  ...entry(id),
  kind: 'familiar.message',
  data: { author: { id: 'Sam', name: 'Sam' }, text: `Message ${id}` },
})

const conversation = (...ids: number[]) => ({
  ...view(),
  entries: ids.map(message),
})

const itemIds = (store: FamiliarStore) =>
  store.getState().transcript?.items.map((item) => item.id)

test('transcript arrives atomically with views and operations and retains streamed activity', async () => {
  const server = testServer()
  const store = open('/api', { fetch: server.fetch })
  expect(store.getState().transcript).toBeUndefined()
  const observed: (string[] | undefined)[] = []
  store.subscribe(() => observed.push(itemIds(store)))
  await expect.poll(server.connections).toBe(1)
  server.send(frame('view', conversation(1)))
  await expect.poll(() => itemIds(store)).toEqual(['entry:1'])
  const initial = store.getState().transcript

  server.send(
    frame('ops', [['s', ['docs', 'pi.live'], { run: { taskId: 'run-1' } }]]),
  )
  await expect.poll(() => store.getState().transcript?.busy).toBe(true)
  expect(itemIds(store)).toEqual(['entry:1', 'waiting:run-1'])
  expect(store.getState().transcript).not.toBe(initial)
  server.send(frame('ops', [['d', ['docs', 'pi.live']]]))
  await expect.poll(() => store.getState().transcript?.busy).toBe(false)
  expect(observed).toEqual([
    ['entry:1'],
    ['entry:1', 'waiting:run-1'],
    ['entry:1'],
  ])
})

test('transcript reference survives unrelated updates and history loading or failure', async () => {
  let fail = true
  const server = testServer(() =>
    fail
      ? Response.json({ error: 'Try again' }, { status: 500 })
      : Response.json({ entries: [message(1)], more: false }),
  )
  const store = open('/api', { fetch: server.fetch })
  await expect.poll(server.connections).toBe(1)
  server.send(frame('view', conversation(2)))
  await expect.poll(() => itemIds(store)).toEqual(['entry:2'])
  const initial = store.getState().transcript
  // Operations that leave the view unchanged, and other sources' events.
  server.send(frame('ops', []))
  server.send(frame('account', null))
  server.send(frame('document', { name: 'memory', value: { facts: [] } }))
  await expect.poll(() => store.getState().memory).toEqual({ facts: [] })
  expect(store.getState().transcript).toBe(initial)

  const load = store.conversation.loadOlder()
  expect(store.getState().history.status).toBe('loading')
  expect(store.getState().transcript).toBe(initial)
  await load
  expect(store.getState().history.status).toBe('failed')
  expect(store.getState().transcript).toBe(initial)
  fail = false
  const published: (string[] | undefined)[] = []
  const unsubscribe = store.subscribe(() => published.push(itemIds(store)))
  await store.conversation.loadOlder()
  unsubscribe()
  expect(published).toEqual([['entry:2'], ['entry:1', 'entry:2']])
  expect(itemIds(store)).toEqual(['entry:1', 'entry:2'])
  expect(store.getState().transcript).not.toBe(initial)
  const loaded = store.getState().transcript
  await store.conversation.loadOlder()
  store.disconnect()
  expect(store.getState().transcript).toBe(loaded)
})

test('a history page arriving after a reconnect gap cannot restore stale transcript items', async () => {
  let respond!: (response: Response) => void
  const server = testServer(
    () => new Promise<Response>((resolve) => (respond = resolve)),
  )
  const store = open('/api', { fetch: server.fetch })
  await expect.poll(server.connections).toBe(1)
  server.send(frame('view', conversation(3)))
  await expect.poll(() => itemIds(store)).toEqual(['entry:3'])
  const load = store.conversation.loadOlder()
  server.send(frame('view', conversation(9)))
  await expect.poll(() => itemIds(store)).toEqual(['entry:9'])
  const fresh = store.getState().transcript
  respond(Response.json({ entries: [message(2)], more: false }))
  await load
  expect(itemIds(store)).toEqual(['entry:9'])
  expect(store.getState().transcript).toBe(fresh)
})
