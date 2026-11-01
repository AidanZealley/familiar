import { eventRoutes } from './http-events.ts'
import type { Op } from '@earendil-works/chord/delta'
import type { ConversationView } from '@earendil-works/pi-durable'
import { Hono } from 'hono'
import type { AccountState } from './account/index.ts'
import { accountRoutes } from './account/http.ts'
import { conversationRoutes, modelRoutes } from './conversation/http.ts'
import type { Familiar } from './familiar.ts'
import type { EpisodesState, FactsState } from './memory/index.ts'
import { memoryRoutes } from './memory/http.ts'
import { connectionRoutes } from './plugins/http.ts'
import { mcpRoutes } from './mcp/http.ts'
import { pushRoutes, type PushHost } from './push.ts'
import type { SchedulesState } from './schedules/index.ts'
import { scheduleRoutes } from './schedules/http.ts'

// The wire contract every client speaks. Owned here; @familiar-ai/client imports
// these types, so a change to the API is a type error on both sides. Routes
// are typed by `HttpApi`; the event stream, which Hono's client can't type,
// by `StreamEvent`. The conversation is Pi's view as it is, so clients type
// it with Pi's own types.
export type {
  MESSAGE_KIND,
  MessageData,
  ModelOption,
  SCHEDULED_KIND,
  ScheduledData,
} from './conversation/index.ts'
export type { AgentState } from '@earendil-works/pi-durable'
export type { AccountState } from './account/index.ts'
export type { Schedule, SchedulesState } from './schedules/index.ts'
export type { PushHost, PushSubscriptionJson } from './push.ts'
export type { McpConnectionInfo, McpServer } from './mcp/index.ts'
export type {
  Connection,
  ConnectionInfo,
  PluginSecret,
} from './plugins/index.ts'
export type {
  Episode,
  EpisodesState,
  Fact,
  FactsState,
  MemoryHealth,
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
  schedules: SchedulesState
}

export type DocumentName = keyof Documents

/**
 * `GET /events` is a server-sent event stream of these. The conversation's
 * view and each document arrive whole first (again after any reconnect),
 * then as each commit's changes, to apply in order to the last value.
 */
export type StreamEvent =
  | { event: 'protocol'; data: { version: number } }
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
  /**
   * The owner's login, whole each time it changes; null once when the host
   * manages credentials itself and offers no sign-in.
   */
  | { event: 'account'; data: AccountState | null }

export type HttpOptions = {
  /**
   * Who is making this request, or undefined to refuse it. Hosts own auth:
   * the daemon trusts its network, an app checks its own session. The answer
   * is the author of any message the request sends, which the model sees.
   */
  authenticate: (
    request: Request,
  ) => string | undefined | Promise<string | undefined>
  /** Web Push, if the host offers it; the push routes answer 404 without it. */
  push?: PushHost
}

/** The Familiar HTTP API as a fetch handler. Mount it under any path. */
export function createHttpApi(familiar: Familiar, options: HttpOptions) {
  return new Hono<{ Variables: { author: string } }>()
    .use(async (c, next) => {
      const author = await options.authenticate(c.req.raw)

      if (author === undefined) {
        return c.json({ error: 'unauthorized' }, 401)
      }

      c.set('author', author)
      await next()
    })
    .route(
      '/',
      eventRoutes({
        conversation: familiar.watch,
        memory: familiar.memory.watch,
        episodes: familiar.memory.watchEpisodes,
        schedules: familiar.schedules.watch,
        account: familiar.account ?? null,
      }),
    )
    .route(
      '/',
      conversationRoutes(familiar, (c) => c.get('author')),
    )
    .route('/account', accountRoutes(familiar.account))
    .route('/model', modelRoutes(familiar))
    .route('/memory', memoryRoutes(familiar.memory))
    .route('/schedules', scheduleRoutes(familiar.schedules))
    .route('/push', pushRoutes(options.push))
    .route('/connections', connectionRoutes(familiar.connections))
    .route('/mcp', mcpRoutes(familiar.mcp))
}

export {
  accountRoutes,
  conversationRoutes,
  modelRoutes,
  memoryRoutes,
  scheduleRoutes,
  pushRoutes,
  connectionRoutes,
  mcpRoutes,
}
export { eventRoutes, type EventSources } from './http-events.ts'
