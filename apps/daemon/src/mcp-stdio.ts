import type { McpStdioTransport } from '@familiar/core'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

/** The SDK filters inherited environment variables and owns process cleanup. */
export const stdioTransport = ({ command, args }: McpStdioTransport) =>
  new StdioClientTransport({ command, args })
