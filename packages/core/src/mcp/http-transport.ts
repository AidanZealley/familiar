import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { authorizedFetch } from '../plugins/authorized-fetch.ts'
import type { PluginFetch } from '../plugins/types.ts'
import { tokenDeclaration, type McpServer } from './servers.ts'

export class McpHttpError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`MCP endpoint answered HTTP ${status}.`)
    this.status = status
  }
}

/** Only this owner-chosen endpoint may use the host's private-network access. */
export function httpTransport(
  server: McpServer,
  fetch: PluginFetch,
  token: () => Promise<string>,
  signal: AbortSignal,
) {
  return new StreamableHTTPClientTransport(new URL(server.transport.url), {
    requestInit: { redirect: 'error' },
    fetch: async (input, init) => {
      const request = new Request(input, init)
      if (
        request.url !== server.transport.url ||
        !['GET', 'POST', 'DELETE'].includes(request.method)
      ) {
        throw new Error('MCP requests must use the configured endpoint.')
      }
      const settings: RequestInit = {
        method: request.method,
        headers: request.headers,
        body: request.body ? await request.arrayBuffer() : undefined,
        signal: AbortSignal.any([
          request.method === 'DELETE' ? AbortSignal.timeout(2_000) : signal,
          request.signal,
        ]),
        redirect: 'error',
      }
      const response =
        server.transport.auth.type === 'bearer'
          ? await authorizedFetch(
              fetch,
              tokenDeclaration(server),
              token,
              request.url,
              settings,
            )
          : await fetch(request.url, settings)
      if (!response.ok) {
        await response.body?.cancel()
        throw new McpHttpError(response.status)
      }
      return response
    },
  })
}
