import type { McpConnectionInfo } from '../mcp/servers.ts'
import type { Connection } from './secrets.ts'

/**
 * How plugins reach the network: the Fetch API's signature, so a host can
 * pass `fetch` itself where that's safe.
 */
export type PluginFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

/**
 * A secret a plugin or MCP server declares: what the owner sees, and the only
 * requests it may be sent with.
 */
export type PluginSecret = {
  name: string
  /** For the owner, on the Connections page. */
  label: string
  help?: string
  /** Where authenticated requests may send it. */
  sendAs: {
    header: string
    /** Before the value, such as `Bearer `. */
    prefix?: string
    /** Exactly, such as `https://api.example.com`: no subdomains. */
    origin: string
    /** Exactly; no patterns. */
    requests: { method: string; path: string }[]
  }
}

/** A connection as the owner sees it: never a secret's value. */
export type PluginConnectionInfo = {
  kind: 'plugin'
  name: string
  title: string
  /** Its tools, each with the description the model is given. */
  tools: { name: string; description: string }[]
  secrets: {
    name: string
    label: string
    help?: string
    /** Where it's sent, so the owner knows who they're trusting with it. */
    origin: string
    set: boolean
  }[]
}

export type ConnectionInfo = PluginConnectionInfo | McpConnectionInfo

export type ConnectionsApi = {
  list(): Promise<ConnectionInfo[]>
  /**
   * Stores `secretValue(value)`. Rejects with a ConnectionError when the
   * connection has no such secret, and with an Error when the value can't be
   * sent.
   */
  setSecret(
    connection: Connection,
    secret: string,
    value: string,
  ): Promise<void>
  /** Rejects with a ConnectionError when the connection has no such secret. */
  deleteSecret(connection: Connection, secret: string): Promise<void>
}
