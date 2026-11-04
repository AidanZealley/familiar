import { Hono, type Context } from 'hono'
import type {
  BlankEnv,
  ExtractSchema,
  MergeSchemaPath,
  Schema,
} from 'hono/types'
import { accountOperations } from '../account/http.ts'
import {
  conversationOperations,
  modelOperations,
} from '../conversation/http.ts'
import type { Familiar } from '../familiar.ts'
import type { EventSources } from './events.ts'
import type { AuthorEnv, Operation } from './guard.ts'
import { mcpOperations } from '../mcp/http.ts'
import { memoryOperations } from '../memory/http.ts'
import { connectionOperations } from '../plugins/http.ts'
import { pushOperations, type PushHost } from './push.ts'
import { scheduleOperations } from '../schedules/http.ts'

/**
 * Every operation, each a one-route Hono app owned by its feature, grouped
 * as clients group their commands. Its names are the names hosts select,
 * and its apps give their types.
 */
export const operations = (familiar: Familiar, push: PushHost | undefined) => ({
  conversation: {
    ...at(
      '/',
      conversationOperations(familiar, (c: Context<AuthorEnv>) =>
        c.get('author'),
      ),
    ),
    ...at('/model', modelOperations(familiar)),
  },
  account: at('/account', accountOperations(familiar.account)),
  memory: at('/memory', memoryOperations(familiar.memory)),
  schedules: at('/schedules', scheduleOperations(familiar.schedules)),
  push: at('/push', pushOperations(push)),
  connections: at('/connections', connectionOperations(familiar.connections)),
  mcp: at('/mcp', mcpOperations(familiar.mcp)),
})

/** What `/events` can stream, by the names `EventSources` gives them. */
export const eventSources = (familiar: Familiar) =>
  ({
    conversation: familiar.watch,
    memory: familiar.memory.watch,
    episodes: familiar.memory.watchEpisodes,
    schedules: familiar.schedules.watch,
    account: familiar.account ?? null,
  }) satisfies Required<EventSources>

type Operations = ReturnType<typeof operations>

/** Each operation's route types, by group and name, for clients. */
export type HttpOperations = {
  [Group in keyof Operations]: {
    [Name in keyof Operations[Group]]: ExtractSchema<Operations[Group][Name]>
  }
}

/** A feature's operations mounted at `mount`, so each has its full path. */
function at<Mount extends string, Named extends Record<string, Operation>>(
  mount: Mount,
  named: Named,
) {
  // `route` is how Hono mounts an app; this names the type it gives each one.
  return Object.fromEntries(
    Object.entries(named).map(([name, operation]) => [
      name,
      new Hono().route(mount, operation),
    ]),
  ) as { [Name in keyof Named]: Mounted<Named[Name], Mount> }
}

type Mounted<App, Mount extends string> =
  ExtractSchema<App> extends infer S extends Schema
    ? Hono<BlankEnv, MergeSchemaPath<S, Mount>, '/'>
    : never
