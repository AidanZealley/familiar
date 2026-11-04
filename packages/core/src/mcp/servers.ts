import { z } from 'zod'
import { defineDoc } from '@earendil-works/pi-durable'
import { ConnectionError } from '../plugins/connections.ts'
import type { PluginSecret } from '../plugins/types.ts'

/** A server Familiar won't save: its shape is wrong or `admissionProblem` refuses it. */
export class McpConfigError extends ConnectionError {}

const serverSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  transport: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('http'),
      url: z.url(),
      auth: z.object({ type: z.enum(['none', 'bearer']) }),
    }),
    z.object({
      type: z.literal('stdio'),
      command: z.string().min(1),
      args: z.array(z.string()).default([]),
    }),
  ]),
})

export type McpServer = z.infer<typeof serverSchema>
export type McpHttpTransport = Extract<McpServer['transport'], { type: 'http' }>
export type McpStdioTransport = Extract<
  McpServer['transport'],
  { type: 'stdio' }
>

export const McpServers = defineDoc<{ servers: McpServer[] }>({
  kind: 'familiar.mcp',
  version: 1,
  scope: 'session',
  initial: () => ({ servers: [] }),
  checkpointWhen: () => true,
})

/**
 * A server's shape: what can be saved and read back. Used by the owner API,
 * HTTP input validation and every open. Whether Familiar will connect to it
 * is `admissionProblem`'s answer, kept apart so a saved server that today's
 * rules refuse still reads back and shows as refused, rather than stopping
 * Familiar opening.
 */
export function parseServer(value: unknown): McpServer {
  const parsed = serverSchema.safeParse(value)
  if (!parsed.success) {
    throw new McpConfigError(parsed.error.message)
  }
  const server = parsed.data
  if (server.transport.type === 'stdio') {
    return server
  }
  const url = new URL(server.transport.url)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new McpConfigError(
      'Use HTTP or HTTPS without embedded credentials, query or fragment.',
    )
  }
  return { ...server, transport: { ...server.transport, url: url.href } }
}

/** Bounds on a server's fields, checked by `admissionProblem`. */
export const MCP_LIMITS = {
  url: 2_048,
  command: 1_024,
  args: 64,
  arg: 4_096,
} as const

/** The transports a host passed Familiar, which are the ones it supports. */
export type McpHost = { fetch?: unknown; stdio?: unknown }

/**
 * The one development exception to HTTPS for bearer tokens: an address on
 * this machine, so the token never crosses a network. Tailnet and LAN names
 * get no exception, whatever their suffix; serve those over HTTPS.
 */
const isLoopback = (hostname: string) =>
  hostname === 'localhost' ||
  hostname === '[::1]' ||
  /^127(?:\.\d{1,3}){3}$/.test(hostname)

/**
 * Why Familiar won't connect to `server` on this host, or undefined if it
 * will. Checked before a new server is saved, and again whenever one opens,
 * reconnects or Familiar starts, so a server saved under looser rules is
 * refused, never used.
 */
export function admissionProblem(server: McpServer, host: McpHost) {
  const { transport } = server
  if (transport.type === 'stdio') {
    if (!host.stdio) {
      return 'This host does not run local MCP commands.'
    }
    if (
      transport.command.length > MCP_LIMITS.command ||
      transport.args.length > MCP_LIMITS.args ||
      transport.args.some((arg) => arg.length > MCP_LIMITS.arg)
    ) {
      return `Keep the command to ${MCP_LIMITS.command} characters and ${MCP_LIMITS.args} arguments of ${MCP_LIMITS.arg}.`
    }
    return undefined
  }
  if (!host.fetch) {
    return 'This host has no MCP HTTP transport.'
  }
  if (transport.url.length > MCP_LIMITS.url) {
    return `Keep the URL to ${MCP_LIMITS.url} characters.`
  }
  const url = new URL(transport.url)
  if (
    transport.auth.type === 'bearer' &&
    url.protocol !== 'https:' &&
    !isLoopback(url.hostname)
  ) {
    return 'A bearer token is only sent over HTTPS. Use an https:// URL; plain HTTP is allowed only to localhost, for development.'
  }
  return undefined
}

export function tokenDeclaration(transport: McpHttpTransport): PluginSecret {
  const url = new URL(transport.url)
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
