import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createRoomStore, type RoomStore } from './room.ts'
import { frame, testServer, tick, view } from './testing.ts'

// The page the client runs in, which relative URLs such as `/api` resolve against.
beforeEach(() => {
  vi.stubGlobal('document', { baseURI: 'http://familiar.test/chat' })
})

const opened: RoomStore[] = []
afterEach(() => {
  opened.splice(0).forEach((store) => store.disconnect())
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// Room 1's stream: every store's stream connects alike.
const open = (
  baseUrl: string,
  options?: Parameters<typeof createRoomStore>[2],
) => {
  const store = createRoomStore(baseUrl, 1, options)
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
    .get('/rooms/1/events', (c) =>
      streamSSE(c, async (stream) => {
        streams += 1
        await stream.writeSSE({
          event: 'protocol',
          data: JSON.stringify({ version: 5 }),
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
    .post('/rooms/1/messages', async (c) => {
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

  await expect.poll(() => store.getState().view).toEqual(view(2))
  expect(store.getState().connection).toBe('open')
  await store.send('Hello')
  await expect(store.send('Again')).rejects.toThrow('unauthorized')

  expect(sent).toEqual(['Hello'])
  expect(seen).toEqual([
    'GET /api/rooms/1/events Bearer token-1',
    'GET /api/rooms/1/events Bearer token-2',
    'POST /api/rooms/1/messages Bearer token-3',
    'POST /api/rooms/1/messages Bearer token-4',
  ])
})

test('a dropped or ended stream reconnects and the fresh view replaces the old', async () => {
  const server = testServer()
  const store = open('/api', { fetch: server.fetch })
  await expect.poll(server.connections).toBe(1)
  server.send(retrySoon + frame('view', view(1)))
  await expect.poll(() => store.getState().connection).toBe('open')

  // Each reconnect's handshake opens it again, after `reconnecting`.
  const states: string[] = []
  store.subscribe(({ connection }) => states.push(connection))
  server.drop()
  await expect.poll(server.connections).toBe(2)
  server.send(frame('view', view(2)))
  await expect.poll(() => store.getState().view).toEqual(view(2))
  expect(store.getState().connection).toBe('open')

  server.end()
  await expect.poll(server.connections).toBe(3)
  server.send(frame('view', view(3)))
  await expect.poll(() => store.getState().view).toEqual(view(3))
  expect(states.filter((state, i) => state !== states[i - 1])).toEqual([
    'reconnecting',
    'open',
    'reconnecting',
    'open',
  ])
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

test('disconnect ends the stream at every stage, even through a host fetch that ignores the abort signal', async () => {
  // While the host's fetch is still waiting, what it returns is dropped.
  const refusing = testServer()
  refusing.refuse(401)
  let release = () => {}
  const waiting = open('/api', {
    fetch: async (input, init) => {
      await new Promise<void>((resolve) => (release = resolve))
      return refusing.fetch(input, { ...init, signal: undefined })
    },
  })
  await tick()
  waiting.disconnect()
  release()
  await tick()
  expect(waiting.getState().connection).toBe('connecting')

  // While EventSource takes the response over, its body is cancelled.
  const cancelled = vi.fn()
  let respond!: (response: Response) => void
  const handoff = open('/api', {
    fetch: () => new Promise<Response>((resolve) => (respond = resolve)),
  })
  respond(
    new Response(new ReadableStream({ cancel: cancelled }), {
      headers: { 'Content-Type': 'text/event-stream' },
    }),
  )
  queueMicrotask(() => handoff.disconnect())
  await tick()
  expect(cancelled).toHaveBeenCalledOnce()

  // While reading, the stream is cancelled and the last state stays.
  const server = testServer()
  const reading = open('/api', {
    fetch: (input, init) => server.fetch(input, { ...init, signal: undefined }),
  })
  await expect.poll(server.connections).toBe(1)
  server.send(frame('view', view(1)))
  await expect.poll(() => reading.getState().connection).toBe('open')
  reading.disconnect()
  await tick()
  expect(server.cancellations()).toBe(1)
  expect(reading.getState().view).toEqual(view(1))
})

test.each([
  frame('protocol', { version: 1 }),
  'event: protocol\ndata: {broken\n\n',
  frame('view', view(99)),
])(
  'an incompatible first event stops without applying state: %s',
  async (first) => {
    const server = testServer(undefined, false)
    const store = open('/api', { fetch: server.fetch })
    await expect.poll(server.connections).toBe(1)
    server.send(first + frame('view', view(1)))
    await expect.poll(() => store.getState().connection).toBe('outdated')
    expect(store.getState().view).toBeUndefined()
    await tick()
    expect(server.connections()).toBe(1)
  },
)

test('each reconnect needs its own handshake, and the last view stays without one', async () => {
  const server = testServer(undefined, false)
  const store = open('/api', { fetch: server.fetch })
  await expect.poll(server.connections).toBe(1)
  server.send(
    retrySoon + frame('protocol', { version: 5 }) + frame('view', view(1)),
  )
  await expect.poll(() => store.getState().connection).toBe('open')
  server.end()
  await expect.poll(server.connections).toBe(2)
  server.send(frame('view', view(2)))
  await expect.poll(() => store.getState().connection).toBe('outdated')
  expect(store.getState().view).toEqual(view(1))
  await tick()
  expect(server.connections()).toBe(2)
})
