import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { ConnectionError } from '../plugins/connections.ts'
import { McpConfigError, parseServer } from './servers.ts'
import type { McpApi } from './types.ts'

// Refused configuration answers 400 and a missing server 404.
const routes = () =>
  new Hono().onError((error, c) => {
    if (error instanceof McpConfigError) {
      return c.json({ error: error.message }, 400)
    }
    if (error instanceof ConnectionError) {
      return c.json({ error: error.message }, 404)
    }
    throw error
  })

/** The owner's MCP servers, mounted at `/mcp`, one route each. */
export const mcpOperations = (mcp: McpApi) => ({
  add: routes().post(
    '/',
    validator('json', (body, c) => {
      try {
        return parseServer(body)
      } catch (error) {
        return c.json({ error: (error as Error).message }, 400)
      }
    }),
    async (c) => {
      await mcp.add(c.req.valid('json'))
      return c.body(null, 201)
    },
  ),
  remove: routes().delete('/:name', async (c) => {
    await mcp.remove(c.req.param('name'))
    return c.body(null, 204)
  }),
  reconnect: routes().post('/:name/reconnect', async (c) => {
    await mcp.reconnect(c.req.param('name'))
    return c.body(null, 202)
  }),
})

/** Every MCP route, mounted at `/mcp`. */
export const mcpRoutes = (mcp: McpApi) => {
  const operations = mcpOperations(mcp)
  return new Hono()
    .route('/', operations.add)
    .route('/', operations.remove)
    .route('/', operations.reconnect)
}
