import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createFamiliarStore } from './familiar.ts'
import { createRoomStore, type RoomStore } from './room.ts'
import { createWorkspaceStore } from './workspace.ts'
import { entry, frame, testServer, tick, view } from './testing.ts'

// The page the client runs in, which relative URLs such as `/api` resolve against.
beforeEach(() => {
  vi.stubGlobal('document', { baseURI: 'http://familiar.test/chat' })
})

const opened: { disconnect(): void }[] = []
afterEach(() => {
  opened.splice(0).forEach((store) => store.disconnect())
  vi.unstubAllGlobals()
})

/** Room 1's store. */
const open = (
  baseUrl: string,
  options?: Parameters<typeof createRoomStore>[2],
) => {
  const store = createRoomStore(baseUrl, 1, options)
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
  const { loadOlder } = store

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
    'http://familiar.test/api/rooms/1/history?before=3',
    'http://familiar.test/api/rooms/1/history?before=2',
  ])
  expect(store.getState().history).toEqual({
    entries: [entry(1), entry(2)],
    status: 'start',
  })
  expect(store.getState().view?.entries).toEqual([entry(3)])
})

test('account and documents arrive whole, take patches and can be null', async () => {
  const server = testServer()
  const workspace = createWorkspaceStore('/api', { fetch: server.fetch })
  opened.push(workspace)
  await expect.poll(server.connections).toBe(1)
  expect(workspace.getState().account).toBeUndefined()
  server.send(frame('account', null))
  server.send(
    frame('document', { name: 'familiars', value: { familiars: {} } }),
  )
  await expect.poll(() => workspace.getState().account).toBeNull()
  expect(workspace.getState().familiars).toEqual({ familiars: {} })
  expect(server.requests.at(-1)?.url).toBe('http://familiar.test/api/events')

  const familiar = createFamiliarStore('/api', 7, { fetch: server.fetch })
  opened.push(familiar)
  await expect.poll(server.connections).toBe(2)
  expect(server.requests.at(-1)?.url).toBe(
    'http://familiar.test/api/familiars/7/events',
  )
  server.send(
    frame('document', { name: 'memory', value: { facts: [], next: 1 } }),
  )
  server.send(frame('document', { name: 'schedules', value: {} }))
  server.send(
    frame('document.ops', { name: 'memory', ops: [['s', ['next'], 2]] }),
  )
  server.send(frame('document', { name: 'schedules', value: null }))

  await expect.poll(() => familiar.getState().schedules).toBeNull()
  expect(familiar.getState()).toMatchObject({
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

  await expect(store.send('Hello')).rejects.toThrow('unauthorized')
  status = 503
  await expect(store.stop()).rejects.toThrow('503')

  expect(
    server.requests
      .filter((request) => request.method === 'POST')
      .map((request) => new URL(request.url).pathname),
  ).toEqual(['/api/rooms/1/messages', '/api/rooms/1/stop'])
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
  await store.send('Hello')

  expect(server.requests.map((request) => request.url)).toEqual([
    'http://familiar.test/api/rooms/1/events',
    'http://familiar.test/api/rooms/1/messages',
  ])
})

const message = (id: number) => ({
  ...entry(id),
  kind: 'familiar.message',
  data: { author: { id: 'Sam', name: 'Sam' }, text: `Message ${id}`, at: id },
})

const conversation = (...ids: number[]) => ({
  ...view(),
  entries: ids.map(message),
})

const itemIds = (store: RoomStore) =>
  store.getState().transcript?.items.map((item) => item.id)

test('transcript arrives atomically with views and operations and retains streamed activity', async () => {
  const server = testServer()
  const store = open('/api', { fetch: server.fetch })
  expect(store.getState().transcript).toBeUndefined()
  await expect.poll(() => store.getState().connection).toBe('open')
  const observed: (string[] | undefined)[] = []
  store.subscribe(() => observed.push(itemIds(store)))
  server.send(frame('view', conversation(1)))
  await expect.poll(() => itemIds(store)).toEqual(['entry:1'])
  const initial = store.getState().transcript

  server.send(
    frame('document', {
      name: 'turns',
      value: { 5: { familiar: 1, cause: 1, status: 'queued' } },
    }),
  )
  await expect.poll(() => store.getState().transcript?.busy).toBe(true)
  expect(itemIds(store)).toEqual(['entry:1', 'turn:5'])
  expect(store.getState().transcript).not.toBe(initial)
  server.send(frame('document.ops', { name: 'turns', ops: [['d', ['5']]] }))
  await expect.poll(() => store.getState().transcript?.busy).toBe(false)
  expect(observed).toEqual([['entry:1'], ['entry:1', 'turn:5'], ['entry:1']])
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
  // Operations that leave the view unchanged.
  server.send(frame('ops', []))
  await tick()
  const unrelated = store.getState().transcript
  expect(unrelated).toBe(initial)

  const load = store.loadOlder()
  expect(store.getState().history.status).toBe('loading')
  expect(store.getState().transcript).toBe(unrelated)
  await load
  expect(store.getState().history.status).toBe('failed')
  expect(store.getState().transcript).toBe(unrelated)
  fail = false
  const published: (string[] | undefined)[] = []
  const unsubscribe = store.subscribe(() => published.push(itemIds(store)))
  await store.loadOlder()
  unsubscribe()
  expect(published).toEqual([['entry:2'], ['entry:1', 'entry:2']])
  expect(itemIds(store)).toEqual(['entry:1', 'entry:2'])
  expect(store.getState().transcript).not.toBe(unrelated)
  const loaded = store.getState().transcript
  await store.loadOlder()
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
  const load = store.loadOlder()
  server.send(frame('view', conversation(9)))
  await expect.poll(() => itemIds(store)).toEqual(['entry:9'])
  const fresh = store.getState().transcript
  respond(Response.json({ entries: [message(2)], more: false }))
  await load
  expect(itemIds(store)).toEqual(['entry:9'])
  expect(store.getState().transcript).toBe(fresh)
})
