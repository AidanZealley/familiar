import type { ExtractSchema } from 'hono/types'
import type { HttpOperations } from './catalogue.ts'
import type { chosenEventRoutes, EventSources } from './events.ts'
import type { Allow } from './guard.ts'

type Group = keyof HttpOperations
type EventSource = keyof EventSources

/**
 * The routes `createHttpApi` serves, by group and operation, and the event
 * sources `/events` streams. Each one left out isn't mounted at all, so it
 * answers 404; with no event sources there is no `/events`. Choosing account
 * routes doesn't stream the account: that is `events.account`.
 */
export type HttpRoutes = {
  [G in Group]?: { [Name in keyof HttpOperations[G]]?: Allow }
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

/** What each group, and `events`, can name. */
type Names = { [G in Group]: keyof HttpOperations[G] } & {
  events: EventSource
}

/** Names that aren't routes or sources become errors, as misspellings. */
export type Known<Routes> = Routes extends true
  ? unknown
  : {
      [G in keyof Routes]: G extends keyof Names
        ? Routes[G] extends true
          ? unknown
          : {
              [Name in keyof Routes[G]]: Name extends Names[G] ? unknown : never
            }
        : never
    }

type EventsSchema = ExtractSchema<ReturnType<typeof chosenEventRoutes>>

/** `true` spelled out: every operation in every group, and every source. */
type Everything = HttpOperations & { events: true }

/** The route types of each operation `Routes` names. */
type ChosenOperations<Routes> = {
  [G in keyof Routes & Group]: HttpOperations[G][keyof Routes[G] &
    keyof HttpOperations[G]]
}[keyof Routes & Group]

/** `/events`'s route type, if `Routes` names any source. */
type ChosenEvents<Routes> = Routes extends { events: infer Sources }
  ? Sources extends true
    ? EventsSchema
    : keyof Sources extends never
      ? never
      : EventsSchema
  : never

/** The route types of every operation and source `Routes` chooses. */
export type SelectedSchema<Routes> = Routes extends true
  ? SelectedSchema<Everything>
  : ChosenOperations<Routes> | ChosenEvents<Routes>

/** Each chosen route's or event source's `Allow`, by group and name. */
export type Selection = Partial<Record<string, Record<string, Allow>>>

/**
 * Checks a selection against `choosable`, the operations by group and the
 * event sources as `events`, for JavaScript callers too. `true` becomes
 * every one of them, and `events: true` every source.
 */
export function selection(
  routes: unknown,
  choosable: Record<string, object>,
): Selection {
  const every = (group: string) =>
    Object.fromEntries(
      Object.keys(choosable[group]).map((name) => [name, true as const]),
    )
  if (routes === true) {
    return Object.fromEntries(
      Object.keys(choosable).map((group) => [group, every(group)]),
    )
  }
  if (routes !== undefined && !isRecord(routes)) {
    throw new TypeError('routes must be true or an object of route groups.')
  }
  const selected: Selection = {}
  for (const [group, value] of Object.entries(routes ?? {})) {
    if (!Object.hasOwn(choosable, group)) {
      throw new TypeError(`routes.${group} is not a route group.`)
    }
    selected[group] =
      group === 'events' && value === true
        ? every(group)
        : allowsByName(value, group, Object.keys(choosable[group]))
  }
  return selected
}

function allowsByName(value: unknown, group: string, names: string[]) {
  if (!isRecord(value)) {
    throw new TypeError(`routes.${group} must be an object of routes.`)
  }
  for (const [name, allow] of Object.entries(value)) {
    if (!names.includes(name)) {
      throw new TypeError(`routes.${group}.${name} is not a route.`)
    }
    if (allow !== true && typeof allow !== 'function') {
      throw new TypeError(`routes.${group}.${name} must be true or a function.`)
    }
  }
  return value as Record<string, Allow>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  Object.getPrototypeOf(value) === Object.prototype
