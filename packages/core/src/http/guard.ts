import { Hono, type Context, type Env } from 'hono'
import type { Schema } from 'hono/types'
import type { Author } from '../conversation/message.ts'

/** What `createHttpApi` gives every route: the author it authenticated. */
export type AuthorEnv = { Variables: { author: Author } }

/**
 * Who may use a selected route: `true` for everyone the API authenticates,
 * or the host's own check, asked on every request before the route reads
 * anything or changes anything. Anything but `true` answers 403.
 */
export type Allow =
  true | ((author: Author, request: Request) => boolean | Promise<boolean>)

/** One feature's route, as a Hono app of its own. */
export type Operation = Hono<Env, Schema, string>

export const forbidden = (c: Context) => c.json({ error: 'forbidden' }, 403)

/** Whether `allow` lets this request's author in. */
export const allows = async (allow: Allow, c: Context<AuthorEnv>) =>
  allow === true || (await allow(c.get('author'), c.req.raw)) === true

/**
 * The operation with its check registered for its own method and path, ahead
 * of its handlers, so it guards that route alone. A middleware for every
 * path would also run for the operations mounted beside it.
 */
export function guarded(
  operation: Operation,
  allow: Allow,
): Hono<AuthorEnv, Schema, string> {
  const [route, ...others] = operation.routes
  if (
    !route ||
    route.method === 'ALL' ||
    others.some(
      (other) => other.method !== route.method || other.path !== route.path,
    )
  ) {
    throw new Error('Each operation must be one method and path.')
  }
  const app = new Hono<AuthorEnv>()
  if (allow === true) {
    return app.route('/', operation)
  }
  return app
    .on(route.method, route.path, async (c, next) =>
      (await allows(allow, c)) ? next() : forbidden(c),
    )
    .route('/', operation)
}
