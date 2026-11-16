import type { McpConnectionInfo } from '../mcp/servers.ts'
import type { Policy, ToolAnnotations } from './policy.ts'
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

/** A connection's tool as the owner sees it. */
export type ToolInfo = {
  /** Its name in its connection, as `setPolicy` takes it. */
  name: string
  /** What the model is given, if anything. */
  description?: string
  annotations?: ToolAnnotations
  /**
   * The owner's choice for it: whether it runs at once, asks first or
   * never runs. Without one, it does as `default` says.
   */
  policy?: Policy
  /** What it does without its own: its connection's choice, else its annotations'. */
  default: Policy
}

/** A connection as the owner sees it: never a secret's value. */
export type PluginConnectionInfo = {
  kind: 'plugin'
  name: string
  title: string
  tools: ToolInfo[]
  /** The owner's choice for all its tools without their own. */
  policy?: Policy
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

/** A connection as plugins or MCP list it, before the owner's policies apply. */
export type ListedConnection = ConnectionInfo extends infer C
  ? C extends ConnectionInfo
    ? Omit<C, 'tools' | 'policy'> & {
        tools: Omit<ToolInfo, 'policy' | 'default'>[]
      }
    : never
  : never

/** Plugins' or MCP's half of the API. */
export type ConnectionsSource = Omit<ConnectionsApi, 'list' | 'setPolicy'> & {
  list(): Promise<ListedConnection[]>
}

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
  /**
   * Sets whether `connection`'s `tool`, or without one all its tools
   * without their own, runs, asks first or never runs; `null` goes back to
   * the default. Rejects with a ConnectionError for a connection that
   * isn't there; a tool may be one the server doesn't list right now.
   */
  setPolicy(
    connection: Connection,
    tool: string | undefined,
    policy: Policy | null,
  ): Promise<void>
}
