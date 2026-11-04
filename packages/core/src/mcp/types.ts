import type { PluginConnectionInfo } from '../plugins/types.ts'
import type { Transport } from '@modelcontextprotocol/client'
import type { McpServer, McpStdioTransport } from './servers.ts'

/** Hosts opt into local processes by constructing their own SDK transport. */
export type McpStdioFactory = (config: McpStdioTransport) => Transport

export type McpStatus =
  | { type: 'connecting' | 'connected' | 'disconnected' | 'needs-auth' }
  | { type: 'failed'; error: string }
  /**
   * Familiar won't connect to it as saved, such as a bearer token over plain
   * HTTP, and reconnecting won't change that. Remove it and add it again.
   */
  | { type: 'refused'; error: string }

export type McpToolInfo = { name: string; readOnly: boolean }

export type McpConnectionInfo = Omit<PluginConnectionInfo, 'kind'> & {
  status: McpStatus
  kind: 'mcp'
  transport: McpServer['transport']
  tools: McpToolInfo[]
}

export type McpApi = {
  /**
   * Saves and connects a server. Rejects with a ConnectionError, saving
   * nothing, when its shape is wrong or `admissionProblem` refuses it.
   */
  add(server: McpServer): Promise<void>
  remove(name: string): Promise<void>
  reconnect(name: string): Promise<void>
}
