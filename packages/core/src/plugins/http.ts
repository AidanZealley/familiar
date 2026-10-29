import { Hono, type Context } from 'hono'
import { validator } from 'hono/validator'
import { ConnectionError, secretValue } from './connections.ts'
import type { ConnectionsApi } from './types.ts'
import type { Connection } from './secrets.ts'

const KINDS: readonly string[] = [
  'plugin',
  'mcp',
] satisfies Connection['kind'][]

// Its output keeps the path's names: Hono's typed client derives the params
// it sends from them.
const secretPath = validator('param', (params, c) => {
  if (!KINDS.includes(params.kind)) {
    return c.json({ error: 'no such connection' }, 404)
  }
  return {
    kind: params.kind as Connection['kind'],
    name: params.name,
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
        const value =
          typeof body?.value === 'string' ? secretValue(body.value) : undefined
        if (value === undefined) {
          return c.json(
            { error: 'value must be visible ASCII characters' },
            400,
          )
        }
        return { value }
      }),
      async (c) => {
        const { kind, name, secret } = c.req.valid('param')
        try {
          await connections.setSecret(
            { kind, name },
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
      const { kind, name, secret } = c.req.valid('param')
      try {
        await connections.deleteSecret({ kind, name }, secret)
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
