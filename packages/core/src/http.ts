import type { Op } from '@earendil-works/chord/delta'
import type { ConversationView, EntryId } from '@earendil-works/pi-durable'
import type { MemoryState } from './memory/index.ts'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { Familiar } from './familiar.ts'

// The wire contract every client speaks. Owned here; @familiar/client imports
// these types, so a change to the API is a type error on both sides.

export type { ConversationView }
// The vocabulary inside a view, so clients need no Pi packages of their own.
export type {
  EntryRecord,
  InboxState,
  LiveState,
  ToolSlot,
} from '@earendil-works/pi-durable'
export type {
  AssistantMessage,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from '@earendil-works/pi-ai'
export type { MESSAGE_KIND, MessageData } from './conversation/message.ts'

/**
 * `GET /history?before=<entryId>&limit=<n>`: up to `limit` (at most 200)
 * entries older than `before`, newest first.
 */
export type { HistoryPage } from './conversation/api.ts'

const HISTORY_LIMIT = 200
export type { Fact, MemoryState } from './memory/index.ts'

/**
 * `GET /events` is a server-sent event stream of these. Each kind of state
 * arrives whole first (again after any reconnect), then as each commit's
 * changes, to apply in order to the last value.
 */
export type StreamEvent =
  | { event: 'view'; data: ConversationView }
  | { event: 'ops'; data: readonly Op[] }
  | { event: 'memory'; data: Readonly<MemoryState> | null }
  | { event: 'memory.ops'; data: readonly Op[] }

/** `POST /messages` */
export type SendBody = { text: string; requestId: string }

/** `PUT /memory/:id` replaces a fact's text; `DELETE /memory/:id` forgets it. */
export type ReviseBody = { text: string }

export type HttpOptions = {
  /**
   * Who is making this request, or undefined to refuse it. Hosts own auth:
   * the daemon trusts its network, an app checks its own session.
   */
  authenticate: (
    request: Request,
  ) => string | undefined | Promise<string | undefined>
}

/** The Familiar HTTP API as a fetch handler. Mount it under any path. */
export function createHttpApi(familiar: Familiar, options: HttpOptions) {
  return new Hono<{ Variables: { author: string } }>()
    .use(async (c, next) => {
      const author = await options.authenticate(c.req.raw)
      if (author === undefined) return c.json({ error: 'unauthorized' }, 401)
      c.set('author', author)
      await next()
    })
    .get('/events', (c) =>
      streamSSE(c, async (stream) => {
        const send = (message: StreamEvent) =>
          stream.writeSSE({
            event: message.event,
            data: JSON.stringify(message.data),
          })
        const conversation = await familiar.watch()
        await send({ event: 'view', data: conversation.value })
        conversation.start((_view, ops) => send({ event: 'ops', data: ops }))

        const memory = await familiar.memory.watch()
        await send({ event: 'memory', data: memory.value })
        memory.start((_memory, ops) => send({ event: 'memory.ops', data: ops }))

        const watches = [conversation, memory]

        // Proxies close streams that look idle.
        const heartbeat = setInterval(
          () => void stream.write(': ping\n\n'),
          15_000,
        )
        const stop = () => watches.forEach((watch) => void watch.stop())
        stream.onAbort(stop)
        await Promise.race(watches.map((watch) => watch.closed))
        stop()
        clearInterval(heartbeat)
      }),
    )
    .get('/history', async (c) => {
      const before = Number(c.req.query('before'))
      if (!Number.isSafeInteger(before))
        return c.json({ error: 'before must be an entry ID' }, 400)
      const limit = Number(c.req.query('limit') ?? 50)
      if (!Number.isSafeInteger(limit) || limit < 1)
        return c.json({ error: 'limit must be a positive integer' }, 400)
      return c.json(
        await familiar.history(
          before as EntryId,
          Math.min(limit, HISTORY_LIMIT),
        ),
      )
    })
    .post('/messages', async (c) => {
      const body = await c.req.json<SendBody>()
      if (typeof body.text !== 'string' || !body.text.trim())
        return c.json({ error: 'text is required' }, 400)
      if (typeof body.requestId !== 'string' || !body.requestId)
        return c.json({ error: 'requestId is required' }, 400)
      await familiar.send({
        author: c.get('author'),
        text: body.text,
        requestId: body.requestId,
      })
      return c.body(null, 202)
    })
    .post('/abort', async (c) => {
      await familiar.abort()
      return c.body(null, 202)
    })
    .put('/memory/:id', async (c) => {
      const body = await c.req.json<ReviseBody>()
      if (typeof body.text !== 'string' || !body.text.trim())
        return c.json({ error: 'text is required' }, 400)
      await familiar.memory.revise(c.req.param('id'), body.text.trim())
      return c.body(null, 204)
    })
    .delete('/memory/:id', async (c) => {
      await familiar.memory.forget(c.req.param('id'))
      return c.body(null, 204)
    })
}
