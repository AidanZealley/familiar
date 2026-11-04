import type { Extension, Registry } from '@earendil-works/pi-durable'
import {
  SdkHttpError,
  StreamableHTTPClientTransport,
  type Transport,
} from '@modelcontextprotocol/client'
import type { SecretStore } from '../plugins/secrets.ts'
import type { PluginFetch } from '../plugins/types.ts'
import { connectMcp } from './index.ts'
import { httpTransport } from './http-transport.ts'
import type { McpServer } from './servers.ts'
import type {
  McpConnectionInfo,
  McpToolInfo,
  McpStdioFactory,
} from './types.ts'

/** One connection owns its status, streams and registered tools until closed. */
export function openConnection(
  server: McpServer,
  registry: Registry,
  options: {
    fetch?: PluginFetch
    secrets?: SecretStore
    stdio?: McpStdioFactory
    expired(): void
  },
) {
  const abort = new AbortController()
  let info: McpConnectionInfo = {
    ...server,
    kind: 'mcp',
    title: server.name,
    secrets: [],
    tools: [],
    status: { type: 'connecting' },
  }
  let closeClient = async () => {}
  const install = (extension: Extension, tools: McpToolInfo[]) => {
    if (!abort.signal.aborted) {
      registry.install(extension)
      info = { ...info, status: { type: 'connected' }, tools }
    }
  }
  const failed = (error: unknown) => {
    if (!abort.signal.aborted) {
      info = {
        ...info,
        status:
          error instanceof SdkHttpError && error.status === 401
            ? { type: 'needs-auth' }
            : {
                type: 'failed',
                error: error instanceof Error ? error.message : String(error),
              },
      }
    }
  }
  const ready = (async () => {
    const config = server.transport
    const token = () =>
      options.secrets?.get({ kind: 'mcp', name: server.name }, 'token') ??
      Promise.resolve(undefined)
    try {
      if (
        config.type === 'http' &&
        config.auth.type === 'bearer' &&
        !(await token())
      ) {
        info = { ...info, status: { type: 'needs-auth' } }
        return
      }
      abort.signal.throwIfAborted()
      let transport: Transport
      if (config.type === 'stdio') {
        if (!options.stdio) {
          throw new Error('This host has no MCP stdio transport.')
        }
        transport = options.stdio(config)
      } else {
        if (!options.fetch) {
          throw new Error('This host has no MCP HTTP transport.')
        }
        transport = httpTransport(
          config,
          options.fetch,
          async () => {
            const value = await token()
            if (!value) {
              throw new Error('MCP bearer token is missing.')
            }
            return value
          },
          abort.signal,
        )
      }
      const connection = await connectMcp(server.name, transport, {
        signal: abort.signal,
        changed: install,
        failed,
        closed: () => {
          if (!abort.signal.aborted) {
            registry.uninstall({ name: `familiar.mcp.${server.name}` })
            info = { ...info, status: { type: 'disconnected' }, tools: [] }
          }
        },
        callFailed: (error) => {
          if (!abort.signal.aborted && error instanceof SdkHttpError) {
            if (error.status === 401) {
              failed(error)
            } else if (error.status === 404) {
              options.expired()
            }
          }
        },
      })
      closeClient = async () => {
        if (transport instanceof StreamableHTTPClientTransport) {
          try {
            await transport.terminateSession()
          } catch {
            /* The session may already be expired or unreachable. */
          }
        }
        await connection.close()
      }
      install(connection.extension, connection.tools)
    } catch (error) {
      failed(error)
    }
  })()
  return {
    server,
    info: () => structuredClone(info),
    close: async () => {
      abort.abort()
      registry.uninstall({ name: `familiar.mcp.${server.name}` })
      await ready
      await closeClient()
      info = { ...info, status: { type: 'disconnected' }, tools: [] }
    },
  }
}
