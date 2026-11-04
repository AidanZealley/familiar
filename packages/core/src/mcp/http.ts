import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { can, type AccessEnv } from '../http/access.ts'
import { ConnectionError } from '../plugins/connections.ts'
import { McpConfigError, parseServer } from './servers.ts'
import type { McpApi } from './types.ts'

/**
 * The owner's MCP servers, mounted at `/mcp`. A malformed configuration
 * answers 400 and a missing server 404.
 */
export const mcpRoutes = (mcp: McpApi) =>
  new Hono<AccessEnv>()
    .onError((error, c) => {
      if (error instanceof McpConfigError) {
        return c.json({ error: error.message }, 400)
      }
      if (error instanceof ConnectionError) {
        return c.json({ error: error.message }, 404)
      }
      throw error
    })
    .post(
      '/',
      can('mcp.add'),
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
    )
    .delete('/:name', can('mcp.remove'), async (c) => {
      await mcp.remove(c.req.param('name'))
      return c.body(null, 204)
    })
    .post('/:name/reconnect', can('mcp.reconnect'), async (c) => {
      await mcp.reconnect(c.req.param('name'))
      return c.body(null, 202)
    })
