import { HTTPException } from 'hono/http-exception'

/**
 * `value`, or a 404 naming `what` is missing. For routes to call once
 * `allow` has agreed, so nobody refused learns what exists.
 */
export function found<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new HTTPException(404, {
      res: Response.json({ error: `No such ${what}.` }, { status: 404 }),
    })
  }
  return value
}
