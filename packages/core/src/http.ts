import { streamEvents, type EventSources } from './http-events.ts'
import { forbidden, guarded, type Operation } from './http-guard.ts'
import type { Op } from '@earendil-works/chord/delta'
import type { ConversationView } from '@earendil-works/pi-durable'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type {
  BlankSchema,
  ExtractSchema,
  MergeSchemaPath,
  Schema,
} from 'hono/types'
import type { AccountState } from './account/index.ts'
import { accountOperations, accountRoutes } from './account/http.ts'
import {
  conversationOperations,
  conversationRoutes,
  modelOperations,
  modelRoutes,
} from './conversation/http.ts'
import type { Author } from './conversation/message.ts'
import type { Familiar } from './familiar.ts'
import type { EpisodesState, FactsState } from './memory/index.ts'
import { memoryOperations, memoryRoutes } from './memory/http.ts'
import { connectionOperations, connectionRoutes } from './plugins/http.ts'
import { mcpOperations, mcpRoutes } from './mcp/http.ts'
import { pushOperations, pushRoutes, type PushHost } from './push.ts'
import type { SchedulesState } from './schedules/index.ts'
import { scheduleOperations, scheduleRoutes } from './schedules/http.ts'

// The wire contract every client speaks. Owned here; @familiar-ai/client imports
// these types, so a change to the API is a type error on both sides. Routes
// are typed by `HttpApi`; the event stream, which Hono's client can't type,
// by `StreamEvent`. The conversation is Pi's view as it is, so clients type
// it with Pi's own types.
export type {
  Author,
  MESSAGE_KIND,
  MessageData,
  StoredMessageData,
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
 * Who may use a selected route: `true` for everyone the API authenticates,
 * or the host's own check, asked on every request before the route reads
 * anything or changes anything. Anything but `true` answers 403.
 */
export type Allow =
  true | ((author: Author, request: Request) => boolean | Promise<boolean>)

type Env = { Variables: { author: Author } }

/**
 * Every operation, each a one-route Hono app owned by its feature, grouped
 * as clients group their commands and keyed by where the group mounts. Its
 * names are the names hosts select, and its apps give their types.
 */
const operations = (familiar: Familiar, push: PushHost | undefined) => ({
  conversation: {
    '/': conversationOperations(familiar, (c: Context<Env>) => c.get('author')),
    '/model': modelOperations(familiar),
  },
  account: { '/account': accountOperations(familiar.account) },
  memory: { '/memory': memoryOperations(familiar.memory) },
  schedules: { '/schedules': scheduleOperations(familiar.schedules) },
  push: { '/push': pushOperations(push) },
  connections: { '/connections': connectionOperations(familiar.connections) },
  mcp: { '/mcp': mcpOperations(familiar.mcp) },
})

/** What `/events` can stream, by the names `EventSources` gives them. */
const eventSources = (familiar: Familiar) =>
  ({
    conversation: familiar.watch,
    memory: familiar.memory.watch,
    episodes: familiar.memory.watchEpisodes,
    schedules: familiar.schedules.watch,
    account: familiar.account ?? null,
  }) satisfies Required<EventSources>

type Operations = ReturnType<typeof operations>
type Group = keyof Operations
type EventSource = keyof EventSources
type OperationName<G extends Group> = {
  [Mount in keyof Operations[G]]: keyof Operations[G][Mount]
}[keyof Operations[G]]
type OperationSchema<G extends Group, Name> = {
  [
    Mount in keyof Operations[G] & string
  ]: Name extends keyof Operations[G][Mount]
    ? ExtractSchema<Operations[G][Mount][Name]> extends infer S extends Schema
      ? MergeSchemaPath<S, Mount>
      : never
    : never
}[keyof Operations[G] & string]

/**
 * The routes `createHttpApi` serves, by group and operation, and the event
 * sources `/events` streams. Each one left out isn't mounted at all, so it
 * answers 404; with no event sources there is no `/events`. Choosing account
 * routes doesn't stream the account: that is `events.account`.
 */
export type HttpRoutes = {
  [G in Group]?: { [Name in OperationName<G>]?: Allow }
} & {
  /**
   * The sources `/events` streams, each checked once as a stream connects:
   * revoking access later doesn't close a stream that's already open. A
   * stream every chosen source refuses answers 403. `true` is every source.
   */
  events?: true | { [Source in EventSource]?: Allow }
}

/**
 * The selection `createHttpApi` takes. `true` serves every route and every
 * event source to everyone it authenticates, including any added later:
 * only for hosts that only their owner can reach, such as the daemon.
 */
export type RouteSelection = true | HttpRoutes

/** Each operation's route types, by group and name, for clients. */
export type HttpOperations = {
  [G in Group]: { [Name in OperationName<G>]: OperationSchema<G, Name> }
}

type EventsSchema = ExtractSchema<ReturnType<typeof events>>

type SelectedSchema<Routes> = Routes extends true
  ? { [G in Group]: OperationSchema<G, OperationName<G>> }[Group] | EventsSchema
  : | {
        [G in keyof Routes & Group]: OperationSchema<G, keyof Routes[G]>
      }[keyof Routes & Group]
    | (Routes extends { events: infer Sources }
        ? Sources extends true
          ? EventsSchema
          : keyof Sources extends never
            ? never
            : EventsSchema
        : never)

/** Names that aren't routes or sources become errors, as misspellings. */
type Known<Routes> = Routes extends true
  ? unknown
  : {
      [G in keyof Routes]: G extends 'events'
        ? Routes[G] extends true
          ? unknown
          : {
              [Source in keyof Routes[G]]: Source extends EventSource
                ? unknown
                : never
            }
        : G extends Group
          ? {
              [Name in keyof Routes[G]]: Name extends OperationName<G>
                ? unknown
                : never
            }
          : never
    }

/** The API `createHttpApi` returns for a selection, for Hono's typed client. */
type HttpApiFor<Routes extends RouteSelection> = Hono<
  Env,
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
 * private. What tools run is the host's `authorizeTool`, asked as each runs.
 */
export function createHttpApi<
  const Routes extends RouteSelection = Record<never, never>,
>(
  familiar: Familiar,
  options: HttpOptions & { routes?: Routes & Known<Routes> },
) {
  const all: Catalogue = operations(familiar, options.push)
  const sources = eventSources(familiar)
  const select = selection(all, sources, options.routes)
  const api = new Hono<Env>()
    .use(async (c, next) => {
      const author = await options.authenticate(c.req.raw)

      if (author === undefined) {
        return c.json({ error: 'unauthorized' }, 401)
      }

      c.set('author', author)
      await next()
    })
    .use(bodyLimit({ maxSize: options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE }))

  for (const [group, mounts] of Object.entries(all)) {
    for (const [mount, named] of Object.entries(mounts)) {
      for (const [name, operation] of Object.entries(named)) {
        const allow = select.operations[group]?.[name]
        if (allow !== undefined) {
          api.route(mount, guarded(operation, allow))
        }
      }
    }
  }
  if (select.events) {
    api.route('/', events(sources, select.events))
  }
  // The loop mounts exactly the selected operations, whose types these are.
  return api as unknown as HttpApiFor<Routes>
}

/** `/events` with each chosen source asked as a stream connects. */
const events = (
  sources: Required<EventSources>,
  chosen: Partial<Record<EventSource, Allow>>,
) =>
  new Hono<Env>().get('/events', async (c) => {
    const allowed: EventSources = {}
    for (const [name, allow] of Object.entries(chosen) as [
      EventSource,
      Allow,
    ][]) {
      if (
        allow === true ||
        (await allow(c.get('author'), c.req.raw)) === true
      ) {
        Object.assign(allowed, { [name]: sources[name] })
      }
    }
    return Object.keys(allowed).length ? streamEvents(c, allowed) : forbidden(c)
  })

/** Groups of mounts of named operations, as the loops read them. */
type Catalogue = Record<string, Record<string, Record<string, Operation>>>

type Selection = {
  operations: Record<string, Record<string, Allow> | undefined>
  events: Partial<Record<EventSource, Allow>> | undefined
}

/** Checks a selection against the real names, for JavaScript callers too. */
function selection(
  all: Catalogue,
  allSources: Required<EventSources>,
  routes: RouteSelection | undefined,
): Selection {
  const names = (group: Record<string, object>) =>
    Object.values(group).flatMap((named) => Object.keys(named))
  const sources = Object.keys(allSources)
  const every = (keys: string[]) =>
    Object.fromEntries(keys.map((key) => [key, true as const]))
  if (routes === undefined) {
    return { operations: {}, events: undefined }
  }
  if (routes === true) {
    return {
      operations: Object.fromEntries(
        Object.entries(all).map(([group, mounts]) => [
          group,
          every(names(mounts)),
        ]),
      ),
      events: every(sources),
    }
  }
  const choices = (value: unknown, where: string, known: string[]) => {
    if (!isRecord(value)) {
      throw new TypeError(`${where} must be an object of routes.`)
    }
    for (const [name, allow] of Object.entries(value)) {
      if (!known.includes(name)) {
        throw new TypeError(`${where}.${name} is not a route.`)
      }
      if (allow !== true && typeof allow !== 'function') {
        throw new TypeError(`${where}.${name} must be true or a function.`)
      }
    }
    return value as Record<string, Allow>
  }
  if (!isRecord(routes)) {
    throw new TypeError('routes must be true or an object of route groups.')
  }
  const selected: Selection = { operations: {}, events: undefined }
  for (const [group, value] of Object.entries(routes)) {
    if (group === 'events') {
      selected.events =
        value === true
          ? every(sources)
          : choices(value, 'routes.events', sources)
    } else if (Object.hasOwn(all, group)) {
      selected.operations[group] = choices(
        value,
        `routes.${group}`,
        names(all[group]),
      )
    } else {
      throw new TypeError(`routes.${group} is not a route group.`)
    }
  }
  if (selected.events && !Object.keys(selected.events).length) {
    selected.events = undefined
  }
  return selected
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  Object.getPrototypeOf(value) === Object.prototype

export {
  accountOperations,
  accountRoutes,
  conversationOperations,
  conversationRoutes,
  modelOperations,
  modelRoutes,
  memoryOperations,
  memoryRoutes,
  scheduleOperations,
  scheduleRoutes,
  pushOperations,
  pushRoutes,
  connectionOperations,
  connectionRoutes,
  mcpOperations,
  mcpRoutes,
}
export { eventRoutes, type EventSources } from './http-events.ts'
