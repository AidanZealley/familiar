import { Type } from '@earendil-works/pi-ai'
import { defineTool, type Extension } from '@earendil-works/pi-durable'
import { Client, type Transport } from '@modelcontextprotocol/client'
import { toolResult } from './tool-result.ts'

/** The host owns transport construction; only the daemon may spawn processes. */
export async function connectMcp(name: string, transport: Transport) {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(name)) {
    throw new Error('MCP server names must match [a-z][a-z0-9-]{0,31}.')
  }
  const client = new Client({ name: 'familiar', version: '1.0.0' })
  try {
    await client.connect(transport, { timeout: 15_000 })
    const { tools } = await client.listTools(undefined, { timeout: 15_000 })
    const extension: Extension = {
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
          execute: async (args, _api, context) =>
            toolResult(
              await client.callTool(
                { name: tool.name, arguments: args },
                { signal: context.abortSignal },
              ),
            ),
        })
      }),
    }
    return { extension, close: () => client.close() }
  } catch (error) {
    await client.close()
    throw error
  }
}
