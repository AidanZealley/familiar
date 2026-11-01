import type { McpServer } from '@familiar-ai/core/http'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createFamiliarStore, type FamiliarStore } from './store.ts'
import { entry, frame, testServer, view } from './testing.ts'

// The page the client runs in, which relative URLs such as `/api` resolve against.
beforeEach(() => {
  vi.stubGlobal('document', { baseURI: 'http://familiar.test/chat' })
})

const opened: FamiliarStore[] = []
afterEach(() => {
  opened.splice(0).forEach((store) => store.getState().disconnect())
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

test('account is undefined until the server says, and null when it offers no sign-in', async () => {
  const server = testServer()
  const store = open('/api', { fetch: server.fetch })
  await expect.poll(server.connections).toBe(1)
  expect(store.getState().account.state).toBeUndefined()

  server.send(frame('account', null))
  await expect.poll(() => store.getState().account.state).toBeNull()

  server.send(frame('account', { status: 'signed-in' }))
  await expect
    .poll(() => store.getState().account.state)
    .toEqual({ status: 'signed-in' })
})

test('loadOlder pages back to the start, one request per page', async () => {
  const server = testServer(history)
  const store = open('/api', { fetch: server.fetch })
  await expect.poll(server.connections).toBe(1)
  server.send(frame('view', view(3)))
  await expect.poll(() => store.getState().connection).toBe('open')
  const {
    conversation: { loadOlder },
  } = store.getState()

  const first = loadOlder()
  expect(store.getState().conversation.history.status).toBe('loading')
  // A second call while loading shares the first's request.
  expect(loadOlder()).toBe(first)
  expect(await first).toBe(true)
  expect(await loadOlder()).toBe(false)
  expect(await loadOlder()).toBe(false)

  expect(
    server.requests
      .map((request) => request.url)
      .filter((url) => url.includes('/history')),
  ).toEqual([
    'http://familiar.test/api/history?before=3',
    'http://familiar.test/api/history?before=2',
  ])
  expect(store.getState().conversation.history).toEqual({
    entries: [entry(1), entry(2)],
    status: 'start',
  })
  expect(store.getState().conversation.view?.entries).toEqual([entry(3)])
})

test("MCP edits reach their routes and reject with the server's reason", async () => {
  const server = testServer((request) =>
    request.url.endsWith('/reconnect')
      ? new Response(null, { status: 202 })
      : Response.json(
          { error: 'MCP server notes already exists.' },
          { status: 404 },
        ),
  )
  const store = open('/api', { fetch: server.fetch })
  const { mcp } = store.getState()
  const notes: McpServer = {
    name: 'notes',
    transport: { type: 'stdio', command: 'notes-mcp', args: [] },
  }

  await expect(mcp.add(notes)).rejects.toThrow(
    'MCP server notes already exists.',
  )
  await mcp.reconnect('notes')

  const sent = await Promise.all(
    server.requests
      .filter((request) => request.url.includes('/mcp'))
      .map(
        async (request) =>
          `${request.method} ${request.url} ${await request.text()}`,
      ),
  )
  expect(sent.map((line) => line.trim())).toEqual([
    `POST http://familiar.test/api/mcp ${JSON.stringify(notes)}`,
    'POST http://familiar.test/api/mcp/notes/reconnect',
  ])
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

  await expect(store.getState().conversation.send('Hello')).rejects.toThrow(
    'unauthorized',
  )
  status = 503
  await expect(store.getState().conversation.abort()).rejects.toThrow('503')

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
  await store.getState().conversation.send('Hello')

  expect(server.requests.map((request) => request.url)).toEqual([
    'http://familiar.test/api/events',
    'http://familiar.test/api/messages',
  ])
})

const message = (id: number) => ({
  ...entry(id),
  kind: 'familiar.message',
  data: { author: 'Sam', text: `Message ${id}` },
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
  server.send(frame('account', null))
  server.send(frame('document', { name: 'memory', value: { facts: [] } }))
  await expect.poll(() => store.getState().memory.facts).toEqual({ facts: [] })
  expect(store.getState().transcript).toBe(initial)

  const load = store.getState().conversation.loadOlder()
  expect(store.getState().conversation.history.status).toBe('loading')
  expect(store.getState().transcript).toBe(initial)
  await expect(load).rejects.toThrow('Try again')
  expect(store.getState().conversation.history.status).toBe('failed')
  expect(store.getState().transcript).toBe(initial)
  fail = false
  const published: (string[] | undefined)[] = []
  const unsubscribe = store.subscribe(() => published.push(itemIds(store)))
  await store.getState().conversation.loadOlder()
  unsubscribe()
  expect(published).toEqual([['entry:2'], ['entry:1', 'entry:2']])
  expect(itemIds(store)).toEqual(['entry:1', 'entry:2'])
  expect(store.getState().transcript).not.toBe(initial)
  const loaded = store.getState().transcript
  await store.getState().conversation.loadOlder()
  store.getState().disconnect()
  expect(store.getState().transcript).toBe(loaded)
})

test('transcript carries compacted entries into history and drops history across reconnect gaps', async () => {
  const server = testServer(() =>
    Response.json({ entries: [message(1)], more: false }),
  )
  const store = open('/api', { fetch: server.fetch })
  await expect.poll(server.connections).toBe(1)
  server.send('retry: 5\n\n' + frame('view', conversation(2, 3)))
  await expect.poll(() => itemIds(store)).toEqual(['entry:2', 'entry:3'])
  await store.getState().conversation.loadOlder()
  const compacted = {
    ...conversation(3),
    entries: [{ ...entry(4), kind: 'pi.compaction', head: 3 }, message(3)],
  }
  server.send(frame('ops', [['s', ['entries'], compacted.entries]]))
  await expect
    .poll(() => itemIds(store))
    .toEqual(['entry:1', 'entry:2', 'entry:4', 'entry:3'])
  const beforeReconnect = store.getState().transcript
  server.drop()
  await expect.poll(() => store.getState().connection).toBe('reconnecting')
  expect(store.getState().transcript).toBe(beforeReconnect)
  await expect.poll(server.connections).toBe(2)
  server.send(frame('view', conversation(9)))
  await expect.poll(() => itemIds(store)).toEqual(['entry:9'])
  expect(store.getState().conversation.history.entries).toEqual([])
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
  const load = store.getState().conversation.loadOlder()
  server.send(frame('view', conversation(9)))
  await expect.poll(() => itemIds(store)).toEqual(['entry:9'])
  const fresh = store.getState().transcript
  respond(Response.json({ entries: [message(2)], more: false }))
  await load
  expect(itemIds(store)).toEqual(['entry:9'])
  expect(store.getState().transcript).toBe(fresh)
})

test('public store exposes only read and subscription methods', () => {
  const store = open('/api', { fetch: testServer().fetch })
  expect(Object.keys(store).sort()).toEqual([
    'getInitialState',
    'getState',
    'subscribe',
  ])
})

test('operations that leave view references unchanged retain the transcript', async () => {
  const server = testServer()
  const store = open('/api', { fetch: server.fetch })
  await expect.poll(server.connections).toBe(1)
  server.send(frame('view', conversation(1)))
  await expect.poll(() => itemIds(store)).toEqual(['entry:1'])
  const initial = store.getState().transcript
  const feature = store.getState().conversation
  server.send(frame('ops', []))
  server.send(frame('account', null))
  await expect.poll(() => store.getState().account.state).toBeNull()
  expect(store.getState().transcript).toBe(initial)
  expect(store.getState().conversation).toBe(feature)
})

test('feature data retains commands and sibling documents across patches, nulls and reconnects', async () => {
  const server = testServer()
  const store = open('/api', { fetch: server.fetch })
  const initial = store.getInitialState()
  await expect.poll(server.connections).toBe(1)
  server.send('retry: 5\n\n' + frame('view', view(1)))
  server.send(frame('account', { status: 'signed-in' }))
  server.send(
    frame('document', { name: 'memory', value: { facts: [], next: 1 } }),
  )
  server.send(
    frame('document', { name: 'episodes', value: { episodes: [], next: 1 } }),
  )
  server.send(frame('document', { name: 'schedules', value: {} }))
  await expect.poll(() => store.getState().schedules.items).toEqual({})
  const received = store.getState()
  expect(received.account.signIn).toBe(initial.account.signIn)
  expect(received.memory.revise).toBe(initial.memory.revise)
  expect(received.schedules.cancel).toBe(initial.schedules.cancel)
  expect(received.conversation.send).toBe(initial.conversation.send)
  expect(received.conversation.loadOlder).toBe(initial.conversation.loadOlder)

  server.send(
    frame('document.ops', { name: 'memory', ops: [['s', ['next'], 2]] }),
  )
  server.send(
    frame('document.ops', { name: 'episodes', ops: [['s', ['next'], 3]] }),
  )
  server.send(
    frame('document.ops', {
      name: 'schedules',
      ops: [
        [
          's',
          ['reminder'],
          {
            id: 'reminder',
            prompt: 'Call Mum',
            next: 100,
            at: 100,
            created: 0,
          },
        ],
      ],
    }),
  )
  await expect
    .poll(() => store.getState().schedules.items)
    .toEqual({
      reminder: {
        id: 'reminder',
        prompt: 'Call Mum',
        next: 100,
        at: 100,
        created: 0,
      },
    })
  const patched = store.getState()
  expect(patched.memory.facts).toEqual({ facts: [], next: 2 })
  expect(patched.memory.episodes).toEqual({ episodes: [], next: 3 })
  expect(patched.memory.revise).toBe(initial.memory.revise)
  expect(patched.schedules.cancel).toBe(initial.schedules.cancel)
  expect(patched.conversation).toBe(received.conversation)
  expect(patched.account).toBe(received.account)

  server.send(frame('document', { name: 'memory', value: null }))
  await expect.poll(() => store.getState().memory.facts).toBeNull()
  expect(store.getState().memory.episodes).toBe(patched.memory.episodes)
  expect(store.getState().memory.revise).toBe(initial.memory.revise)
  server.drop()
  await expect.poll(server.connections).toBe(2)
  server.send(frame('view', view(2)))
  server.send(
    frame('document', { name: 'memory', value: { facts: [], next: 4 } }),
  )
  await expect.poll(() => store.getState().memory.facts?.next).toBe(4)
  expect(store.getState().memory.revise).toBe(initial.memory.revise)
  expect(store.getState().schedules.cancel).toBe(initial.schedules.cancel)
  expect(store.getState().push).toBe(initial.push)
  expect(store.getState().connections).toBe(initial.connections)
  expect(store.getState().mcp).toBe(initial.mcp)
  await store.getState().memory.revise('fact-1', 'Corrected')
  expect(server.requests.at(-1)?.url).toBe(
    'http://familiar.test/api/memory/fact-1',
  )
})
