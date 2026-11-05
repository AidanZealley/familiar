import type { Connection, SecretStore } from './secrets.ts'
import type { ConnectionsApi } from './types.ts'

/**
 * Connections: what plugins and MCP servers need from outside Familiar, the
 * secrets the owner sets for them, and how a secret is sent. Plugins and MCP
 * each own their side; this is what they share.
 */

export { authorizedFetch, checkDeclaration } from './authorized-fetch.ts'
export { memorySecrets } from './secrets.ts'
export type * from './types.ts'
export type { Connection, SecretStore } from './secrets.ts'

export class ConnectionError extends Error {}

/**
 * A secret's value as it will be sent, or undefined if it can't be. Headers trim surrounding whitespace.
 * Visible ASCII is suitable for API keys and tokens sent in headers.
 */
export function secretValue(value: string) {
  const trimmed = value.trim()
  return /^[\x21-\x7e]([\x20-\x7e]*[\x21-\x7e])?$/.test(trimmed)
    ? trimmed
    : undefined
}

/**
 * Plugins' and MCP servers' connections as one API. Checks each secret once,
 * for both: it must be sendable, and the host must keep secrets at all.
 */
export function allConnections(
  plugins: ConnectionsApi,
  mcp: ConnectionsApi,
  store: SecretStore | undefined,
): ConnectionsApi {
  const owner = (connection: Connection) =>
    connection.kind === 'mcp' ? mcp : plugins
  return {
    list: async () => [...(await plugins.list()), ...(await mcp.list())],
    setSecret: async (connection, name, input) => {
      const value = secretValue(input)
      if (value === undefined) {
        throw new Error('A secret must be visible ASCII characters.')
      }
      if (!store) {
        throw new Error('This host keeps no secrets.')
      }
      await owner(connection).setSecret(connection, name, value)
    },
    deleteSecret: (connection, name) =>
      owner(connection).deleteSecret(connection, name),
  }
}
