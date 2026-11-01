import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createFamiliarStore, type FamiliarStore } from './store.ts'
import { entry, frame, testServer, tick, view } from './testing.ts'

// The page the client runs in, which relative URLs such as `/api` resolve against.
beforeEach(() => {
  vi.stubGlobal('document', { baseURI: 'http://familiar.test/chat' })
})

const opened: FamiliarStore[] = []
afterEach(() => {
  opened.splice(0).forEach((store) => store.getState().disconnect())
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const open = (
  ...[baseUrl, options]: Parameters<typeof createFamiliarStore>
) => {
  const store = createFamiliarStore(baseUrl, options)
  opened.push(store)
  return store
}

// Retry after 5ms instead of 3s, as a server may ask.
const retrySoon = 'retry: 5\n\n'

test('a host fetch authenticates the stream, each reconnect and each command against a Hono API', async () => {
  let issued = 0
  const getCurrentToken = async () => `token-${++issued}`
  const seen: string[] = []
  const sent: string[] = []
  let streams = 0
  const app = new Hono()
    .basePath('/api')
    .use(async (c, next) => {
      const authorization = c.req.header('authorization')
      seen.push(`${c.req.method} ${c.req.path} ${authorization}`)
      if (authorization === 'Bearer token-4') {
        return c.json({ error: 'unauthorized' }, 401)
      }
      await next()
    })
    .get('/events', (c) =>
      streamSSE(c, async (stream) => {
        streams += 1
        await stream.writeSSE({
          event: 'protocol',
          data: JSON.stringify({ version: 1 }),
        })
        await stream.writeSSE({
          event: 'view',
          data: JSON.stringify(view(streams)),
          retry: 5,
        })
        // The first stream ends; the second stays open until the client goes.
        if (streams > 1) {
          await new Promise((resolve) => stream.onAbort(() => resolve(null)))
        }
      }),
    )
    .post('/messages', async (c) => {
      sent.push((await c.req.json()).text)
      return c.body(null, 204)
    })

  // The host's fetch, as in the client's docs.
  const store = open('http://familiar.test/api', {
    fetch: async (input, init) => {
      const request = new Request(input, init)
      request.headers.set('Authorization', `Bearer ${await getCurrentToken()}`)
      return app.fetch(request)
    },
  })

  await expect.poll(() => store.getState().conversation.view).toEqual(view(2))
  expect(store.getState().connection).toBe('open')
  await store.getState().conversation.send('Hello')
  await expect(store.getState().conversation.send('Again')).rejects.toThrow(
    'unauthorized',
  )

  expect(sent).toEqual(['Hello'])
  expect(seen).toEqual([
    'GET /api/events Bearer token-1',
    'GET /api/events Bearer token-2',
    'POST /api/messages Bearer token-3',
    'POST /api/messages Bearer token-4',
  ])
})

test('the parser joins frames split across chunks, multiline data and split UTF-8', async () => {
  const server = testServer()
  const store = open('/api', { fetch: server.fetch })
  await expect.poll(server.connections).toBe(1)

  const facts = { facts: [{ id: 'f1', text: 'Lives in Zürich ☕' }] }
  const bytes = new TextEncoder().encode(
    frame('document', { name: 'memory', value: facts }),
  )
  // One byte at a time splits the two- and three-byte characters too.
  bytes.forEach((byte) => server.send(Uint8Array.of(byte)))
  // A data field over several lines arrives joined by newlines.
  server.send('event: account\ndata: {"status":\ndata: "signed-in"}\n\n')

  await expect.poll(() => store.getState().memory.facts).toEqual(facts)
  await expect
    .poll(() => store.getState().account.state)
    .toEqual({ status: 'signed-in' })
})

test('a dropped or ended stream reconnects and the fresh view replaces the old', async () => {
  const server = testServer((request) => {
    const before = Number(new URL(request.url).searchParams.get('before'))
    return Response.json({ entries: [entry(before - 1)], more: true })
  })
  const store = open('/api', { fetch: server.fetch })
  await expect.poll(server.connections).toBe(1)
  server.send(retrySoon + frame('view', view(3, 4)))
  await expect.poll(() => store.getState().connection).toBe('open')
  await store.getState().conversation.loadOlder()

  server.drop()
  await expect.poll(() => store.getState().connection).toBe('reconnecting')
  await expect.poll(server.connections).toBe(2)
  // Compaction moved the start to 4 meanwhile, so 3 joins loaded history.
  server.send(frame('view', view(4, 5)))
  await expect.poll(() => store.getState().connection).toBe('open')
  expect(store.getState().conversation.view).toEqual(view(4, 5))
  expect(store.getState().conversation.history.entries).toEqual([
    entry(2),
    entry(3),
  ])

  server.end()
  await expect.poll(() => store.getState().connection).toBe('reconnecting')
  await expect.poll(server.connections).toBe(3)
  // A view the old one never reached leaves a gap, so history starts over.
  server.send(frame('view', view(9)))
  await expect.poll(() => store.getState().conversation.view).toEqual(view(9))
  expect(store.getState().conversation.history).toEqual({
    entries: [],
    status: 'more',
  })
})

test.each([
  [401, 'unauthorized'],
  [403, 'unauthorized'],
  [404, 'failed'],
] as const)(
  'a stream answered %i stops retrying as %s',
  async (status, connection) => {
    const server = testServer()
    server.refuse(status)
    const store = open('/api', { fetch: server.fetch })

    await expect.poll(() => store.getState().connection).toBe(connection)
    await tick()
    expect(server.connections()).toBe(1)
  },
)

test('a refused reconnect stops retrying too', async () => {
  const server = testServer()
  const store = open('/api', { fetch: server.fetch })
  await expect.poll(server.connections).toBe(1)
  server.send(retrySoon + frame('view', view(1)))
  await expect.poll(() => store.getState().connection).toBe('open')

  server.refuse(401)
  server.end()
  await expect.poll(() => store.getState().connection).toBe('unauthorized')
  await tick()
  expect(server.connections()).toBe(2)
  // The last view stays for the host to show while it signs back in.
  expect(store.getState().conversation.view).toEqual(view(1))
})

test('server errors and network failures retry after the default delay', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const server = testServer()
  server.refuse(503)
  let failing = true
  const store = open('/api', {
    fetch: (input, init) =>
      failing
        ? Promise.reject(new TypeError('offline'))
        : server.fetch(input, init),
  })

  await vi.waitFor(() =>
    expect(store.getState().connection).toBe('reconnecting'),
  )
  failing = false
  await vi.advanceTimersByTimeAsync(3000)
  expect(server.connections()).toBe(1)
  expect(store.getState().connection).toBe('reconnecting')

  server.refuse(undefined)
  await vi.advanceTimersByTimeAsync(3000)
  expect(server.connections()).toBe(2)
  server.send(frame('view', view(1)))
  await vi.waitFor(() => expect(store.getState().connection).toBe('open'))
})

test('disconnect while the host fetch is still waiting drops what it returns', async () => {
  const server = testServer()
  server.refuse(401)
  let release = () => {}
  const store = open('/api', {
    // Ignores the abort signal, as a slow token lookup might.
    fetch: async (input, init) => {
      await new Promise<void>((resolve) => (release = resolve))
      return server.fetch(input, { ...init, signal: undefined })
    },
  })
  await tick()

  store.getState().disconnect()
  release()
  await tick()

  expect(server.connections()).toBe(1)
  expect(store.getState().connection).toBe('connecting')
})

test('disconnect while reading ignores late frames', async () => {
  const server = testServer()
  const store = open('/api', {
    // The stream it returns ignores the abort signal, unlike fetch's own.
    fetch: (input, init) => server.fetch(input, { ...init, signal: undefined }),
  })
  await expect.poll(server.connections).toBe(1)
  server.send(frame('view', view(1)))
  await expect.poll(() => store.getState().connection).toBe('open')

  store.getState().disconnect()
  await tick()
  expect(server.cancellations()).toBe(1)
  expect(() => server.send(frame('view', view(2)))).toThrow()

  expect(store.getState().conversation.view).toEqual(view(1))
  expect(store.getState().account.state).toBeUndefined()
  expect(server.connections()).toBe(1)
})

test('disconnect while waiting to retry cancels the reconnect', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const server = testServer()
  const store = open('/api', { fetch: server.fetch })
  await vi.waitFor(() => expect(server.connections()).toBe(1))
  server.send(frame('view', view(1)))
  await vi.waitFor(() => expect(store.getState().connection).toBe('open'))

  server.end()
  await vi.waitFor(() =>
    expect(store.getState().connection).toBe('reconnecting'),
  )
  store.getState().disconnect()
  await vi.advanceTimersByTimeAsync(6000)

  expect(server.connections()).toBe(1)
  expect(store.getState().connection).toBe('reconnecting')
})

test('an absolute base URL reaches another origin', async () => {
  const server = testServer()
  const store = open('https://familiar.example/api', { fetch: server.fetch })
  await store.getState().conversation.abort()

  expect(server.requests.map((request) => request.url)).toEqual([
    'https://familiar.example/api/events',
    'https://familiar.example/api/abort',
  ])
})

test.each([200, 401])(
  'disconnect during response handoff cancels a %i body and prevents late updates',
  async (status) => {
    let resolveResponse!: (response: Response) => void
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled })
    const store = open('/api', {
      fetch: () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve
        }),
    })
    const updates = vi.fn()
    store.subscribe(updates)
    resolveResponse(
      new Response(body, {
        status,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    )
    // connect() receives the response first; close before EventSource's next
    // promise handler can validate it or acquire its reader.
    queueMicrotask(() => store.getState().disconnect())
    await tick()
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(updates).not.toHaveBeenCalled()
    expect(store.getState().connection).toBe('connecting')
  },
)

test.each([
  frame('protocol', { version: 2 }),
  'event: protocol\ndata: {broken\n\n',
  frame('protocol', {}),
  frame('view', view(99)),
])(
  'an incompatible first event stops without applying state: %s',
  async (first) => {
    const server = testServer(undefined, false)
    const store = open('/api', { fetch: server.fetch })
    await expect.poll(server.connections).toBe(1)
    server.send(first + frame('view', view(1)))
    await expect.poll(() => store.getState().connection).toBe('outdated')
    expect(store.getState().conversation.view).toBeUndefined()
    await tick()
    expect(server.connections()).toBe(1)
    expect(server.requests).toHaveLength(1)
  },
)

test.each(['Text/Event-Stream', 'TEXT/EVENT-STREAM; charset=utf-8'])(
  'an incompatible handshake is rejected with content type %s',
  async (contentType) => {
    const store = open('/api', {
      fetch: async () =>
        new Response(
          frame('protocol', { version: 2 }) + frame('view', view(99)),
          {
            headers: { 'Content-Type': contentType },
          },
        ),
    })
    await expect.poll(() => store.getState().connection).toBe('outdated')
    expect(store.getState().conversation.view).toBeUndefined()
    expect(store.getState().transcript).toBeUndefined()
  },
)

test('each reconnect requires its own compatible handshake and retains the last view on mismatch', async () => {
  const server = testServer(undefined, false)
  const store = open('/api', { fetch: server.fetch })
  await expect.poll(server.connections).toBe(1)
  // Split the handshake itself, including CRLF boundaries.
  for (const byte of new TextEncoder().encode(
    'event: protocol\r\ndata: {"version":1}\r\n\r\n',
  )) {
    server.send(Uint8Array.of(byte))
  }
  server.send(retrySoon + frame('view', view(1)))
  await expect.poll(() => store.getState().connection).toBe('open')
  server.end()
  await expect.poll(server.connections).toBe(2)
  server.send(frame('protocol', { version: 2 }) + frame('view', view(2)))
  await expect.poll(() => store.getState().connection).toBe('outdated')
  expect(store.getState().conversation.view).toEqual(view(1))
  await tick()
  expect(server.connections()).toBe(2)
})

test('silent streams keep connecting and retry when they end', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const server = testServer(undefined, false)
  const store = open('/api', { fetch: server.fetch })
  await vi.waitFor(() => expect(server.connections()).toBe(1))
  await vi.advanceTimersByTimeAsync(30_000)
  expect(store.getState().connection).toBe('connecting')
  server.end()
  await vi.waitFor(() =>
    expect(store.getState().connection).toBe('reconnecting'),
  )
  await vi.advanceTimersByTimeAsync(3_000)
  expect(server.connections()).toBe(2)
})

test('handshake acceptance waits for a view', async () => {
  const server = testServer(undefined, false)
  const store = open('/api', { fetch: server.fetch })
  await expect.poll(server.connections).toBe(1)
  server.send(frame('protocol', { version: 1 }))
  await tick()
  expect(store.getState().connection).toBe('connecting')
  server.send(frame('view', view(1)))
  await expect.poll(() => store.getState().connection).toBe('open')
})

test('outdated stops stream retries and leaves HTTP commands unchanged', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const server = testServer(() => Response.json([]), false)
  const store = open('/api', { fetch: server.fetch })
  await vi.waitFor(() => expect(server.connections()).toBe(1))
  server.send(frame('protocol', { version: 99 }))
  await vi.waitFor(() => expect(store.getState().connection).toBe('outdated'))
  await vi.advanceTimersByTimeAsync(30_000)
  await expect(store.getState().conversation.modelOptions()).resolves.toEqual(
    [],
  )
  await expect(store.getState().account.signOut()).resolves.toBeUndefined()
  expect(server.connections()).toBe(1)
  expect(server.requests.map((request) => request.method)).toEqual([
    'GET',
    'GET',
    'POST',
  ])
})

test('a compatible handshake and view in one chunk opens the connection', async () => {
  const server = testServer(undefined, false)
  const store = open('/api', { fetch: server.fetch })
  await expect.poll(server.connections).toBe(1)
  server.send(frame('protocol', { version: 1 }) + frame('view', view(1)))
  await expect.poll(() => store.getState().connection).toBe('open')
  expect(store.getState().conversation.view).toEqual(view(1))
})

test('a reconnect cannot reuse the previous connection handshake', async () => {
  const server = testServer(undefined, false)
  const store = open('/api', { fetch: server.fetch })
  await expect.poll(server.connections).toBe(1)
  server.send(
    retrySoon + frame('protocol', { version: 1 }) + frame('view', view(1)),
  )
  await expect.poll(() => store.getState().connection).toBe('open')
  server.end()
  await expect.poll(server.connections).toBe(2)
  server.send(frame('view', view(2)))
  await expect.poll(() => store.getState().connection).toBe('outdated')
  expect(store.getState().conversation.view).toEqual(view(1))
})

test('disconnect during a view notification prevents later state from the same chunk', async () => {
  const server = testServer(undefined, false)
  const store = open('/api', { fetch: server.fetch })
  await expect.poll(server.connections).toBe(1)
  store.subscribe(() => {
    if (store.getState().conversation.view) {
      store.getState().disconnect()
    }
  })
  server.send(
    frame('protocol', { version: 1 }) +
      frame('view', view(1)) +
      frame('view', view(2)),
  )
  await expect.poll(() => store.getState().conversation.view).toEqual(view(1))
  await tick()
  expect(store.getState().conversation.view).toEqual(view(1))
})
