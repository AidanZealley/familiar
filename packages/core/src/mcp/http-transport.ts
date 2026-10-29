import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { authorizedFetch } from '../plugins/authorized-fetch.ts'
import type { PluginFetch } from '../plugins/types.ts'
import { tokenDeclaration, type McpHttpTransport } from './servers.ts'

/** Only this owner-chosen endpoint may use the host's private-network access. */
export function httpTransport(
  config: McpHttpTransport,
  fetch: PluginFetch,
  token: () => Promise<string>,
  signal: AbortSignal,
) {
  return new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { redirect: 'error' },
    fetch: async (input, init) => {
      const request = new Request(input, init)
      if (
        request.url !== config.url ||
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
      return config.auth.type === 'bearer'
        ? await authorizedFetch(
            fetch,
            tokenDeclaration(config),
            token,
            request.url,
            settings,
          )
        : await fetch(request.url, settings)
    },
  })
}
