import type { Extension, ToolRegistration } from '@earendil-works/pi-durable'
import type { Notification } from '../schedules/index.ts'
import type { Connection, SecretStore } from './secrets.ts'

/**
 * How plugins reach the network: the Fetch API's signature, so a host can
 * pass `fetch` itself where that's safe.
 */
export type PluginFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

/**
 * What Familiar gives a plugin's extension. Credentials are attached by
 * authorizedFetch, rather than passed to plugin code.
 */
export type PluginContext = {
  now(): number
  notify(notification: Notification): Promise<void>
  /** The host's fetch, which keeps plugins off its private networks. */
  fetch: PluginFetch
  /**
   * A request carrying the named secret, made through `fetch` only if it
   * matches what the secret declares; otherwise throws without sending.
   * Throws a message the model reads as "not connected" when it isn't set.
   * Redirects come back as responses, unfollowed.
   */
  authorizedFetch(
    secret: string,
    input: string | URL,
    init?: RequestInit,
  ): Promise<Response>
}

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

/**
 * Everything that isn't core arrives as a plugin: a Pi extension, built with
 * what Familiar provides around it. Core names the extension
 * `familiar.plugin.<name>`.
 */
export type FamiliarPlugin = {
  /** Keys its secrets, so keep it stable. */
  name: string
  /** For the owner, on the Connections page. */
  title: string
  secrets?: PluginSecret[]
  extension: (context: PluginContext) => Extension
}

/** A connection as the owner sees it: never a secret's value. */
export type ConnectionInfo = {
  kind: 'plugin'
  name: string
  title: string
  secrets: {
    name: string
    label: string
    help?: string
    /** Where it's sent, so the owner knows who they're trusting with it. */
    origin: string
    set: boolean
  }[]
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
}

/** A host policy applied once, when plugins are installed. */
export type PluginProtection = (access: {
  fetch: PluginFetch
  secrets?: SecretStore
  credentials: readonly { connection: Connection; secret: string }[]
}) => {
  fetch: PluginFetch
  secrets?: SecretStore
  wrapTool(tool: ToolRegistration): ToolRegistration
}
