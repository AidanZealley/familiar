import type { PluginConnectionInfo } from '../plugins/types.ts'
import type { McpServer } from './servers.ts'

export type McpStatus =
  | { type: 'connecting' | 'connected' | 'disconnected' | 'needs-auth' }
  | { type: 'failed'; error: string }

export type McpToolInfo = { name: string; readOnly: boolean }

export type McpConnectionInfo = Omit<PluginConnectionInfo, 'kind'> & {
  status: McpStatus
  kind: 'mcp'
  transport: McpServer['transport']
  tools: McpToolInfo[]
}

export type McpApi = {
  add(server: McpServer): Promise<void>
  remove(name: string): Promise<void>
  reconnect(name: string): Promise<void>
}
