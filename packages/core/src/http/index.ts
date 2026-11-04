import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { BlankSchema } from 'hono/types'
import type { Author } from '../conversation/message.ts'
import type { Familiar } from '../familiar.ts'
import { eventSources, operations } from './catalogue.ts'
import { chosenEventRoutes } from './events.ts'
import { guarded, type AuthorEnv } from './guard.ts'
import {
  selection,
  type Known,
  type RouteSelection,
  type SelectedSchema,
} from './selection.ts'
import type { PushHost } from './push.ts'

// The wire contract every client speaks, and the types of choosing routes.
export type * from './contract.ts'
export type { Allow } from './guard.ts'
export type { HttpOperations } from './catalogue.ts'
export type { HttpRoutes, RouteSelection } from './selection.ts'

// Each feature's operations, and its routes mounted together, to compose by hand.
export { accountOperations, accountRoutes } from '../account/http.ts'
export {
  conversationOperations,
  conversationRoutes,
  modelOperations,
  modelRoutes,
} from '../conversation/http.ts'
export { memoryOperations, memoryRoutes } from '../memory/http.ts'
export { scheduleOperations, scheduleRoutes } from '../schedules/http.ts'
export { pushOperations, pushRoutes } from './push.ts'
export { connectionOperations, connectionRoutes } from '../plugins/http.ts'
export { mcpOperations, mcpRoutes } from '../mcp/http.ts'
export { eventRoutes, type EventSources } from './events.ts'

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
   * The routes to serve; none by default. See `HttpRoutes`. `true` serves
   * every route and event source, including any added later, so pass it
   * only when everyone `authenticate` accepts is the Familiar's owner.
   */
  routes?: RouteSelection
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

/**
 * The API `createHttpApi` returns for a selection, for Hono's typed client.
 * Written out here, not imported, so hosts' declarations can name it.
 */
type HttpApiFor<Routes extends RouteSelection> = Hono<
  { Variables: { author: Author } },
  [SelectedSchema<Routes>] extends [never]
    ? BlankSchema
    : SelectedSchema<Routes>
>

/** Every route, as the daemon serves them: `hc<HttpApi>(baseUrl)`. */
export type HttpApi = HttpApiFor<true>

/**
 * Familiar's HTTP API as a fetch handler, serving only the routes chosen in
 * `routes`. Every request is authenticated first (401), then its body is
 * bounded (413), then the chosen route's own `Allow` is asked (403), all
 * before the route reads the body or changes anything. Mount it under any
 * path; export `typeof api` for the frontend's typed client.
 *
 * Everyone it authenticates and lets send shares one conversation, so they
 * all read its history and whatever the model says, which can include
 * anything it remembers: leaving memory out of `events` doesn't make memory
 * private. They also share every tool installed on the Familiar; a tool or
 * the app API behind it narrows what each may do, using `api.invoker`.
 */
export function createHttpApi<
  const Routes extends RouteSelection = Record<never, never>,
>(
  familiar: Familiar,
  options: HttpOptions & { routes?: Routes & Known<Routes> },
) {
  const catalogue = operations(familiar, options.push)
  const sources = eventSources(familiar)
  const { events = {}, ...chosen } = selection(options.routes, {
    ...catalogue,
    events: sources,
  })
  const api = new Hono<AuthorEnv>()
    .use(async (c, next) => {
      const author = await options.authenticate(c.req.raw)

      if (author === undefined) {
        return c.json({ error: 'unauthorized' }, 401)
      }

      c.set('author', author)
      await next()
    })
    .use(bodyLimit({ maxSize: options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE }))

  for (const [group, named] of Object.entries(catalogue)) {
    for (const [name, operation] of Object.entries(named)) {
      const allow = chosen[group]?.[name]
      if (allow !== undefined) {
        api.route('/', guarded(operation, allow))
      }
    }
  }
  if (Object.keys(events).length) {
    api.route('/', chosenEventRoutes(sources, events))
  }
  // The loop mounts exactly the selected operations, whose types these are.
  return api as unknown as HttpApiFor<Routes>
}
