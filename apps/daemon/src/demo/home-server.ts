// The demo's pretend Home Assistant as a standalone MCP server over HTTP,
// for a dev daemon to add as a connection: same devices, tools, result
// shapes and annotations as the demo's (scenarios/home.ts). State lives in
// this process until it stops. Local only.
import { serve } from '@hono/node-server'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server'
import { homeServer } from './scenarios/home.ts'

const port = Number(process.env.HOME_MCP_PORT ?? 8125)
const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>()

serve({
  hostname: '127.0.0.1',
  port,
  fetch: async (request) => {
    if (new URL(request.url).pathname !== '/mcp') {
      return new Response('Not found', { status: 404 })
    }
    let transport = sessions.get(request.headers.get('mcp-session-id') ?? '')
    if (!transport) {
      transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      })
      await homeServer().connect(transport)
    }
    const response = await transport.handleRequest(request)
    if (transport.sessionId) {
      sessions.set(transport.sessionId, transport)
    }
    return response
  },
})
console.log(`Pretend Home Assistant: http://127.0.0.1:${port}/mcp`)
