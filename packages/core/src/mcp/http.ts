import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { ConnectionError } from '../plugins/connections.ts'
import { parseServer } from './servers.ts'
import type { McpApi } from './types.ts'

export const mcpRoutes = (mcp: McpApi) =>
  new Hono()
    .onError((error, c) => {
      if (error instanceof ConnectionError) {
        return c.json({ error: error.message }, 404)
      }
      throw error
    })
    .post(
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
    )
    .delete('/:name', async (c) => {
      await mcp.remove(c.req.param('name'))
      return c.body(null, 204)
    })
    .post('/:name/reconnect', async (c) => {
      await mcp.reconnect(c.req.param('name'))
      return c.body(null, 202)
    })
