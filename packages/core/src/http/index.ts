import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { accountRoutes } from '../account/http.ts'
import type { Author } from '../conversation/message.ts'
import { conversationRoutes } from '../conversation/http.ts'
import type { Familiar } from '../familiar.ts'
import { mcpRoutes } from '../mcp/http.ts'
import { memoryRoutes } from '../memory/http.ts'
import { connectionRoutes } from '../plugins/http.ts'
import { scheduleRoutes } from '../schedules/http.ts'
import type { AccessEnv, Allow } from './access.ts'
import { eventRoutes } from './events.ts'
import { pushRoutes, type PushHost } from './push.ts'

// The wire contract every client speaks, and the names `allow` is asked about.
export type * from './contract.ts'
export type { Allow, Operation } from './access.ts'

export type HttpOptions = {
  /**
   * Who is making this request, or undefined to refuse it with 401. Hosts
   * own auth: the daemon trusts its network, an app checks its own session.
   * The answer is the author of any message the request sends, which the
   * model sees.
   */
  authenticate: (
    request: Request,
  ) => Author | undefined | Promise<Author | undefined>
  /**
   * Whether an author may perform an operation, asked before the route reads
   * anything or changes anything; anything but `true` answers 403. `/events`
   * asks once per source as a stream connects. Check against a list of the
   * operations you allow, so any Familiar adds later is refused until you
   * add it; `() => true` only when everyone `authenticate` accepts is the
   * Familiar's owner.
   */
  allow: Allow
  /** Web Push, if the host offers it; the push routes answer 404 without it. */
  push?: PushHost
  /**
   * The most bytes a request body may have; larger ones get 413 before any
   * route reads them. Default `DEFAULT_MAX_BODY_SIZE`. Field bounds, such
   * as `MESSAGE_LIMITS`, are enforced by Familiar itself for every caller.
   */
  maxBodySize?: number
}

/**
 * Room for the largest message Familiar admits, `MESSAGE_LIMITS.text`, even
 * if JSON escapes every character, with every other request far under it.
 */
export const DEFAULT_MAX_BODY_SIZE = 1024 * 1024

const routes = (familiar: Familiar, push: PushHost | undefined) =>
  new Hono<AccessEnv>()
    .route('/', conversationRoutes(familiar))
    .route('/account', accountRoutes(familiar.account))
    .route('/memory', memoryRoutes(familiar.memory))
    .route('/schedules', scheduleRoutes(familiar.schedules))
    .route('/push', pushRoutes(push))
    .route('/connections', connectionRoutes(familiar.connections))
    .route('/mcp', mcpRoutes(familiar.mcp))
    .route('/', eventRoutes(familiar))

/** Familiar's HTTP API, for Hono's typed client: `hc<HttpApi>(baseUrl)`. */
export type HttpApi = ReturnType<typeof routes>

/**
 * Familiar's HTTP API as a fetch handler. Every request is authenticated
 * first (401), then its body is bounded (413), then `allow` is asked (403),
 * all before the route reads the body or changes anything. Mount it under
 * any path.
 *
 * Everyone it authenticates and lets send shares one conversation, so they
 * all read its history and whatever the model says, which can include
 * anything it remembers: refusing `events.memory` doesn't make memory
 * private. They also share every tool installed on the Familiar; a tool or
 * the app API behind it narrows what each may do, using `api.author`.
 */
export function createHttpApi(
  familiar: Familiar,
  options: HttpOptions,
): HttpApi {
  if (typeof options.allow !== 'function') {
    throw new TypeError('allow must be a function.')
  }
  return new Hono<AccessEnv>()
    .use(async (c, next) => {
      const author = await options.authenticate(c.req.raw)

      if (author === undefined) {
        return c.json({ error: 'unauthorized' }, 401)
      }

      c.set('author', author)
      c.set('allow', options.allow)
      await next()
    })
    .use(bodyLimit({ maxSize: options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE }))
    .route('/', routes(familiar, options.push))
}
