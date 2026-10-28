import { Hono, type Context } from 'hono'
import { validator } from 'hono/validator'
import { ConnectionError, type ConnectionsApi } from './index.ts'
import type { Connection } from './secrets.ts'

const KINDS: readonly string[] = [
  'plugin',
  'mcp',
] satisfies Connection['kind'][]

const secretPath = validator('param', (params, c) => {
  if (!KINDS.includes(params.kind)) {
    return c.json({ error: 'no such connection' }, 404)
  }
  return {
    connection: {
      kind: params.kind as Connection['kind'],
      name: params.name,
    },
    secret: params.secret,
  }
})

/**
 * The owner's connections, mounted at `/connections` by the HTTP API. Secrets
 * are write-only: nothing here returns a value.
 */
export const connectionRoutes = (connections: ConnectionsApi) =>
  new Hono()
    .get('/', async (c) => c.json(await connections.list(), 200))
    .put(
      '/:kind/:name/secrets/:secret',
      secretPath,
      validator('json', (body, c) => {
        if (typeof body?.value !== 'string' || !body.value.trim()) {
          return c.json({ error: 'value is required' }, 400)
        }
        return { value: body.value as string }
      }),
      async (c) => {
        const { connection, secret } = c.req.valid('param')
        try {
          await connections.setSecret(
            connection,
            secret,
            c.req.valid('json').value,
          )
        } catch (error) {
          return notFound(c, error)
        }
        return c.body(null, 204)
      },
    )
    .delete('/:kind/:name/secrets/:secret', secretPath, async (c) => {
      const { connection, secret } = c.req.valid('param')
      try {
        await connections.deleteSecret(connection, secret)
      } catch (error) {
        return notFound(c, error)
      }
      return c.body(null, 204)
    })

/** A ConnectionError as a 404; anything else is a bug, so rethrown. */
const notFound = (c: Context, error: unknown) => {
  if (error instanceof ConnectionError) {
    return c.json({ error: error.message }, 404)
  }
  throw error
}
