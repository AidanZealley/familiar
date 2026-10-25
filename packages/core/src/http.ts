import type { Op } from '@earendil-works/chord/delta'
import type { ConversationView } from '@earendil-works/pi-durable'
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
export type { MESSAGE_KIND, MessageData } from './familiar.ts'

/** `GET /events` is a server-sent event stream of these. */
export type StreamEvent =
  /** The whole view: sent first, and again after any reconnect. */
  | { event: 'view'; data: ConversationView }
  /** One commit's changes; apply in order to the last view. */
  | { event: 'ops'; data: readonly Op[] }

/** `POST /messages` */
export type SendBody = { text: string; requestId: string }

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
        const watch = await familiar.watch()
        const send = (message: StreamEvent) =>
          stream.writeSSE({
            event: message.event,
            data: JSON.stringify(message.data),
          })

        await send({ event: 'view', data: watch.value })
        watch.start((_view, ops) => send({ event: 'ops', data: ops }))

        // Proxies close streams that look idle.
        const heartbeat = setInterval(
          () => void stream.write(': ping\n\n'),
          15_000,
        )
        stream.onAbort(() => void watch.stop())
        await watch.closed
        clearInterval(heartbeat)
      }),
    )
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
}
