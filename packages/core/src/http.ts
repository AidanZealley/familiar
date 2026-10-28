import type { Op } from '@earendil-works/chord/delta'
import type {
  ConversationView,
  DocumentWatch,
  EntryId,
} from '@earendil-works/pi-durable'
import { Hono, type TypedResponse } from 'hono'
import { streamSSE } from 'hono/streaming'
import { validator } from 'hono/validator'
import type { HistoryPage } from './conversation/index.ts'
import type { Familiar } from './familiar.ts'
import type { EpisodesState, FactsState } from './memory/index.ts'
import { memoryRoutes } from './memory/http.ts'

// The wire contract every client speaks. Owned here; @familiar/client imports
// these types, so a change to the API is a type error on both sides. Routes
// are typed by `HttpApi`; the event stream, which Hono's client can't type,
// by `StreamEvent`. The conversation is Pi's view as it is, so clients type
// it with Pi's own types.
export type { MESSAGE_KIND, MessageData } from './conversation/index.ts'
export type {
  Episode,
  EpisodesState,
  Fact,
  FactsState,
} from './memory/index.ts'

/** Every route, for Hono's typed client: `hc<HttpApi>(baseUrl)`. */
export type HttpApi = ReturnType<typeof createHttpApi>

/**
 * The documents mirrored live to clients, by name. Adding one is a line here
 * and a line in `/events`; clients mirror whatever arrives.
 */
export type Documents = {
  memory: FactsState
  episodes: EpisodesState
}

export type DocumentName = keyof Documents

/**
 * `GET /events` is a server-sent event stream of these. The conversation's
 * view and each document arrive whole first (again after any reconnect),
 * then as each commit's changes, to apply in order to the last value.
 */
export type StreamEvent =
  | { event: 'view'; data: ConversationView }
  | { event: 'ops'; data: readonly Op[] }
  | {
      event: 'document'
      data: {
        [Name in DocumentName]: {
          name: Name
          value: Readonly<Documents[Name]> | null
        }
      }[DocumentName]
    }
  | { event: 'document.ops'; data: { name: DocumentName; ops: readonly Op[] } }

export type HttpOptions = {
  /**
   * Who is making this request, or undefined to refuse it. Hosts own auth:
   * the daemon trusts its network, an app checks its own session.
   */
  authenticate: (
    request: Request,
  ) => string | undefined | Promise<string | undefined>
}

/** Entries per `GET /history` page. Clients page by `before`, so they needn't know it. */
const HISTORY_PAGE = 50

/** Proxies close streams that look idle. */
const HEARTBEAT_MS = 15_000

/** The Familiar HTTP API as a fetch handler. Mount it under any path. */
export function createHttpApi(familiar: Familiar, options: HttpOptions) {
  return (
    new Hono<{ Variables: { author: string } }>()
      .use(async (c, next) => {
        const author = await options.authenticate(c.req.raw)

        if (author === undefined) {
          return c.json({ error: 'unauthorized' }, 401)
        }

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

          const streamDocument = async <Name extends DocumentName>(
            name: Name,
            open: () => Promise<DocumentWatch<Documents[Name]>>,
          ) => {
            const document = await open()
            // TypeScript can't match a generic name to its value in the union.
            await send({
              event: 'document',
              data: { name, value: document.value },
            } as StreamEvent)
            document.start((_value, ops) =>
              send({ event: 'document.ops', data: { name, ops } }),
            )
            return document
          }

          const conversation = await familiar.watch()
          await send({ event: 'view', data: conversation.value })
          conversation.start((_view, ops) => send({ event: 'ops', data: ops }))

          const watches = [
            conversation,
            await streamDocument('memory', familiar.memory.watch),
            await streamDocument('episodes', familiar.memory.watchEpisodes),
          ]

          const heartbeat = setInterval(
            () => void stream.write(': ping\n\n'),
            HEARTBEAT_MS,
          )
          const stop = () => watches.forEach((watch) => void watch.stop())

          stream.onAbort(stop)
          await Promise.race(watches.map((watch) => watch.closed))
          stop()
          clearInterval(heartbeat)
        }),
      )
      // A page of entries older than `before`, newest first.
      .get(
        '/history',
        validator('query', (query, c) => {
          const before = Number(query.before)

          if (!Number.isSafeInteger(before)) {
            return c.json({ error: 'before must be an entry ID' }, 400)
          }

          return { before: before as EntryId }
        }),
        async (c) => {
          const { before } = c.req.valid('query')
          const page = await familiar.history(before, HISTORY_PAGE)

          // Pi's entries are already JSON, but their recursive types are too
          // deep for Hono to convert, so the client gets the page's own type.
          return c.json(page) as unknown as TypedResponse<
            HistoryPage,
            200,
            'json'
          >
        },
      )
      .post(
        '/messages',
        validator('json', (body, c) => {
          if (typeof body?.text !== 'string' || !body.text.trim()) {
            return c.json({ error: 'text is required' }, 400)
          }

          if (typeof body.requestId !== 'string' || !body.requestId) {
            return c.json({ error: 'requestId is required' }, 400)
          }

          return {
            text: body.text as string,
            requestId: body.requestId as string,
          }
        }),
        async (c) => {
          await familiar.send({
            author: c.get('author'),
            ...c.req.valid('json'),
          })
          return c.body(null, 202)
        },
      )
      .post('/abort', async (c) => {
        await familiar.abort()
        return c.body(null, 202)
      })
      .route('/memory', memoryRoutes(familiar.memory))
  )
}
