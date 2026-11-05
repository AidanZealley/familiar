import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { can, type AccessEnv } from '../access.ts'
import {
  ConnectionError,
  secretValue,
  type Connection,
  type ConnectionsApi,
} from './index.ts'

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
 * The owner's connections, mounted at `/connections`. Secrets are write-only:
 * nothing here returns a value. Missing connections answer 404; other
 * failures stay server errors.
 */
export const connectionRoutes = (connections: ConnectionsApi) =>
  new Hono<AccessEnv>()
    .onError((error, c) => {
      if (error instanceof ConnectionError) {
        return c.json({ error: error.message }, 404)
      }
      throw error
    })
    .get('/', can('connections.list'), async (c) =>
      c.json(await connections.list(), 200),
    )
    .put(
      '/:kind/:name/secrets/:secret',
      can('connections.setSecret'),
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
        await connections.setSecret(
          { kind, name },
          secret,
          c.req.valid('json').value,
        )
        return c.body(null, 204)
      },
    )
    .delete(
      '/:kind/:name/secrets/:secret',
      can('connections.deleteSecret'),
      secretPath,
      async (c) => {
        const { kind, name, secret } = c.req.valid('param')
        await connections.deleteSecret({ kind, name }, secret)
        return c.body(null, 204)
      },
    )
