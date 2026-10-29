import { Type } from '@earendil-works/pi-ai'
import { defineTool, type Extension } from '@earendil-works/pi-durable'
import { Client, type Transport, type Tool } from '@modelcontextprotocol/client'
import { toolResult } from './tool-result.ts'
import type { McpToolInfo } from './types.ts'

export type { McpApi, McpConnectionInfo } from './types.ts'
export type { McpServer } from './servers.ts'

type BridgeOptions = {
  signal?: AbortSignal
  changed?(extension: Extension, tools: McpToolInfo[]): void
  failed?(error: unknown): void
  callFailed?(error: unknown): void
}

/** The host owns transport construction; only the daemon may spawn processes. */
export async function connectMcp(
  name: string,
  transport: Transport,
  options: BridgeOptions = {},
) {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(name)) {
    throw new Error('MCP server names must match [a-z][a-z0-9-]{0,31}.')
  }
  const client = new Client(
    { name: 'familiar', version: '1.0.0' },
    {
      listChanged: {
        tools: {
          onChanged: (error, tools) => {
            if (options.signal?.aborted) {
              return
            }
            if (error) {
              options.failed?.(error)
              return
            }
            try {
              const next = describe(tools ?? [])
              options.changed?.(next.extension, next.tools)
            } catch (error) {
              options.failed?.(error)
            }
          },
        },
      },
    },
  )
  const describe = (tools: Tool[]) => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      readOnly: tool.annotations?.readOnlyHint === true,
    })),
    extension: {
      name: `familiar.mcp.${name}`,
      tools: tools.map((tool) => {
        const registeredName = `mcp__${name}__${tool.name}`
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(registeredName)) {
          throw new Error(`Unsupported MCP tool name: ${registeredName}`)
        }
        return defineTool({
          name: registeredName,
          description: tool.description ?? tool.name,
          parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema),
          deferred: true,
          replay: 'unsafe',
          execute: async (args, _api, context) => {
            try {
              return toolResult(
                await client.callTool(
                  { name: tool.name, arguments: args },
                  { signal: context.abortSignal },
                ),
              )
            } catch (error) {
              if (!context.abortSignal?.aborted) {
                options.callFailed?.(error)
              }
              throw error
            }
          },
        })
      }),
    } satisfies Extension,
  })
  try {
    await client.connect(transport, { timeout: 15_000, signal: options.signal })
    const { tools } = await client.listTools(undefined, {
      timeout: 15_000,
      signal: options.signal,
    })
    return { ...describe(tools), close: () => client.close() }
  } catch (error) {
    await client.close()
    throw error
  }
}
