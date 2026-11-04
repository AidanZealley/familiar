import { Hono } from 'hono'
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

// Missing connections answer 404; other failures stay server errors.
const routes = () =>
  new Hono().onError((error, c) => {
    if (error instanceof ConnectionError) {
      return c.json({ error: error.message }, 404)
    }
    throw error
  })

/**
 * The owner's connections, mounted at `/connections`, one route each.
 * Secrets are write-only: nothing here returns a value.
 */
export const connectionOperations = (connections: ConnectionsApi) => ({
  list: routes().get('/', async (c) => c.json(await connections.list(), 200)),
  setSecret: routes().put(
    '/:kind/:name/secrets/:secret',
    secretPath,
    validator('json', (body, c) => {
      const value =
        typeof body?.value === 'string' ? secretValue(body.value) : undefined
      if (value === undefined) {
        return c.json({ error: 'value must be visible ASCII characters' }, 400)
      }
      return { value }
    }),
    async (c) => {
      const { kind, name, secret } = c.req.valid('param')
      await connections.setSecret(
        { kind, name },
        secret,
        c.req.valid('json').value,
      )
      return c.body(null, 204)
    },
  ),
  deleteSecret: routes().delete(
    '/:kind/:name/secrets/:secret',
    secretPath,
    async (c) => {
      const { kind, name, secret } = c.req.valid('param')
      await connections.deleteSecret({ kind, name }, secret)
      return c.body(null, 204)
    },
  ),
})

/** Every connection route, mounted at `/connections`. */
export const connectionRoutes = (connections: ConnectionsApi) => {
  const operations = connectionOperations(connections)
  return new Hono()
    .route('/', operations.list)
    .route('/', operations.setSecret)
    .route('/', operations.deleteSecret)
}
