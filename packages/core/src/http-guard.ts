import { Hono, type Context, type Env } from 'hono'
import type { Schema } from 'hono/types'
import type { Author } from './conversation/message.ts'
import type { Allow } from './http.ts'

/** One feature's route, as a Hono app of its own. */
export type Operation = Hono<Env, Schema, string>

export const forbidden = (c: Context) => c.json({ error: 'forbidden' }, 403)

/**
 * The operation with its check registered for its own method and path, ahead
 * of its handlers, so it guards that route alone. A middleware for every
 * path would also run for the operations mounted beside it.
 */
export function guarded(
  operation: Operation,
  allow: Allow,
): Hono<{ Variables: { author: Author } }, Schema, string> {
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
  const app = new Hono<{ Variables: { author: Author } }>()
  if (allow === true) {
    return app.route('/', operation)
  }
  return app
    .on(route.method, route.path, async (c, next) =>
      (await allow(c.get('author'), c.req.raw)) === true
        ? next()
        : forbidden(c),
    )
    .route('/', operation)
}
