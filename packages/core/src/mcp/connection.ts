import { Type } from '@earendil-works/pi-ai'
import {
  defineTool,
  type Extension,
  type Registry,
} from '@earendil-works/pi-durable'
import { createToolSearchTool } from '@earendil-works/pi-durable/tool-search'
import {
  Client,
  SdkHttpError,
  StreamableHTTPClientTransport,
  type Tool,
  type Transport,
} from '@modelcontextprotocol/client'
import type { PluginFetch, SecretStore } from '../connections/index.ts'
import { httpTransport } from './http-transport.ts'
import type {
  McpConnectionInfo,
  McpServer,
  McpStdioFactory,
  McpStatus,
  McpToolInfo,
} from './servers.ts'
import { toolResult } from './tool-result.ts'

const TIMEOUT_MS = 15_000

/** The extension a server's tools are installed as, once for every Familiar. */
export const mcpExtensionName = (server: string) => `familiar.mcp.${server}`

/**
 * One server's connection: its client, its status and its tools in the
 * registry, until closed. A closed connection changes nothing, whatever is
 * still finishing.
 */
export function openConnection(
  server: McpServer,
  registry: Registry,
  options: {
    fetch?: PluginFetch
    secrets?: SecretStore
    stdio?: McpStdioFactory
    /** The server forgot its session; the owner of connections replaces this one. */
    expired(): void
  },
) {
  const extensionName = mcpExtensionName(server.name)
  const closing = new AbortController()
  const { signal } = closing
  let info: McpConnectionInfo = {
    ...server,
    kind: 'mcp',
    title: server.name,
    secrets: [],
    tools: [],
    status: { type: 'connecting' },
  }
  const update = (status: McpStatus, tools = info.tools) => {
    if (!signal.aborted) {
      info = { ...info, status, tools }
    }
  }
  const failed = (error: unknown) =>
    update(
      error instanceof SdkHttpError && error.status === 401
        ? { type: 'needs-auth' }
        : {
            type: 'failed',
            error: error instanceof Error ? error.message : String(error),
          },
    )

  const client = new Client(
    { name: 'familiar', version: '1.0.0' },
    {
      listChanged: {
        tools: {
          onChanged: (error, tools) => {
            if (error) {
              failed(error)
              return
            }
            try {
              install(tools ?? [])
            } catch (error) {
              failed(error)
            }
          },
        },
      },
    },
  )

  // The server's tools as deferred Pi tools, found through tool_search,
  // which every server's extension carries. Pi offers one tool per name, so
  // a Familiar has tool search exactly when it uses an MCP connection.
  const install = (tools: Tool[]) => {
    const extension: Extension = {
      name: extensionName,
      tools: [
        createToolSearchTool(),
        ...tools.map((tool) => {
          const name = `mcp__${server.name}__${tool.name}`
          if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
            throw new Error(`Unsupported MCP tool name: ${name}`)
          }
          return defineTool({
            name,
            description: tool.description ?? tool.name,
            parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema),
            deferred: true,
            execute: async (args, _api, context) => {
              try {
                return toolResult(
                  await client.callTool(
                    { name: tool.name, arguments: args },
                    { signal: context.abortSignal },
                  ),
                )
              } catch (error) {
                if (!context.abortSignal?.aborted && !signal.aborted) {
                  if (error instanceof SdkHttpError && error.status === 401) {
                    failed(error)
                  } else if (
                    error instanceof SdkHttpError &&
                    error.status === 404
                  ) {
                    options.expired()
                  }
                }
                throw error
              }
            },
          })
        }),
      ],
    }
    if (!signal.aborted) {
      registry.install(extension)
      update(
        { type: 'connected' },
        tools.map((tool) => ({
          name: tool.name,
          readOnly: tool.annotations?.readOnlyHint === true,
        })) satisfies McpToolInfo[],
      )
    }
  }

  const token = () =>
    options.secrets?.get({ kind: 'mcp', name: server.name }, 'token') ??
    Promise.resolve(undefined)

  const transportFor = (config: McpServer['transport']): Transport => {
    if (config.type === 'stdio') {
      if (!options.stdio) {
        throw new Error('This host has no MCP stdio transport.')
      }
      return options.stdio(config)
    }
    if (!options.fetch) {
      throw new Error('This host has no MCP HTTP transport.')
    }
    return httpTransport(
      config,
      options.fetch,
      async () => {
        const value = await token()
        if (!value) {
          throw new Error('MCP bearer token is missing.')
        }
        return value
      },
      signal,
    )
  }

  // Set once connected: only an open session is ended on close.
  let connected: Transport | undefined
  const ready = (async () => {
    const config = server.transport
    try {
      if (
        config.type === 'http' &&
        config.auth.type === 'bearer' &&
        !(await token())
      ) {
        update({ type: 'needs-auth' })
        return
      }
      signal.throwIfAborted()
      const transport = transportFor(config)
      await client.connect(transport, { timeout: TIMEOUT_MS, signal })
      const { tools } = await client.listTools(undefined, {
        timeout: TIMEOUT_MS,
        signal,
      })
      connected = transport
      install(tools)
      // Only an established client reports closing; a failed start may
      // finish closing later.
      client.onclose = () => {
        if (!signal.aborted) {
          registry.uninstall({ name: extensionName })
          update({ type: 'disconnected' }, [])
        }
      }
    } catch (error) {
      failed(error)
      await client.close()
    }
  })()

  return {
    server,
    info: () => structuredClone(info),
    close: async () => {
      closing.abort()
      registry.uninstall({ name: extensionName })
      await ready
      if (connected instanceof StreamableHTTPClientTransport) {
        try {
          await connected.terminateSession()
        } catch {
          /* The session may already be expired or unreachable. */
        }
      }
      await client.close()
      info = { ...info, status: { type: 'disconnected' }, tools: [] }
    },
  }
}
