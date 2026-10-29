import { z } from 'zod'
import { defineDoc } from '@earendil-works/pi-durable'
import { ConnectionError } from '../plugins/connections.ts'
import type { PluginSecret } from '../plugins/types.ts'

export type McpServer = {
  name: string
  transport: { type: 'http'; url: string; auth: { type: 'none' | 'bearer' } }
}

export const McpServers = defineDoc<{ servers: McpServer[] }>({
  kind: 'familiar.mcp',
  version: 1,
  scope: 'session',
  initial: () => ({ servers: [] }),
  checkpointWhen: () => true,
})

const serverSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  transport: z.object({
    type: z.literal('http'),
    url: z.url(),
    auth: z.object({ type: z.enum(['none', 'bearer']) }),
  }),
})

/** Used by both the owner API and HTTP input validation. */
export function parseServer(value: unknown): McpServer {
  const parsed = serverSchema.safeParse(value)
  if (!parsed.success) {
    throw new ConnectionError(parsed.error.message)
  }
  const server = parsed.data
  const url = new URL(server.transport.url)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new ConnectionError(
      'Use HTTP or HTTPS without embedded credentials, query or fragment.',
    )
  }
  return { ...server, transport: { ...server.transport, url: url.href } }
}

export function tokenDeclaration(server: McpServer): PluginSecret {
  const url = new URL(server.transport.url)
  return {
    name: 'token',
    label: 'Bearer token',
    sendAs: {
      header: 'Authorization',
      prefix: 'Bearer ',
      origin: url.origin,
      requests: ['GET', 'POST', 'DELETE'].map((method) => ({
        method,
        path: url.pathname,
      })),
    },
  }
}
