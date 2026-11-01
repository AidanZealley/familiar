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
  expect(store.getState().account).toBeUndefined()

  server.send(frame('account', null))
  await expect.poll(() => store.getState().account).toBeNull()

  server.send(frame('account', { status: 'signed-in' }))
  await expect
    .poll(() => store.getState().account)
    .toEqual({ status: 'signed-in' })
})

test('loadOlder pages back to the start, one request per page', async () => {
  const server = testServer(history)
  const store = open('/api', { fetch: server.fetch })
  await expect.poll(server.connections).toBe(1)
  server.send(frame('view', view(3)))
  await expect.poll(() => store.getState().connection).toBe('open')
  const { loadOlder } = store.getState()

  const first = loadOlder()
  expect(store.getState().history.status).toBe('loading')
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
  expect(store.getState().history).toEqual({
    entries: [entry(1), entry(2)],
    status: 'start',
  })
  expect(store.getState().view?.entries).toEqual([entry(3)])
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
  const { addMcpServer, reconnectMcpServer } = store.getState()
  const notes: McpServer = {
    name: 'notes',
    transport: { type: 'stdio', command: 'notes-mcp', args: [] },
  }

  await expect(addMcpServer(notes)).rejects.toThrow(
    'MCP server notes already exists.',
  )
  await reconnectMcpServer('notes')

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

  await expect(store.getState().send('Hello')).rejects.toThrow('unauthorized')
  status = 503
  await expect(store.getState().abort()).rejects.toThrow('503')

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
  await store.getState().send('Hello')

  expect(server.requests.map((request) => request.url)).toEqual([
    'http://familiar.test/api/events',
    'http://familiar.test/api/messages',
  ])
})
