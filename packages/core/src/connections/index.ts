import type { Harness } from '@earendil-works/pi-durable'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  connectionPolicy,
  policyOf,
  setPolicy,
  ToolPolicies,
} from './policy.ts'
import type { Connection, SecretStore } from './secrets.ts'
import type {
  ConnectionInfo,
  ConnectionsApi,
  ConnectionsSource,
} from './types.ts'

/**
 * Connections: what plugins and MCP servers need from outside Familiar, the
 * secrets the owner sets for them, and how a secret is sent. Plugins and MCP
 * each own their side; this is what they share.
 */

export { authorizedFetch, checkDeclaration } from './authorized-fetch.ts'
export { memorySecrets } from './secrets.ts'
export type * from './types.ts'
export type { Connection, SecretStore } from './secrets.ts'
export {
  defaultPolicy,
  POLICIES,
  type Policy,
  type ToolAnnotations,
} from './policy.ts'

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
 * Owns the owner's tool policies, the same for both.
 */
export function allConnections(
  plugins: ConnectionsSource,
  mcp: ConnectionsSource,
  store: SecretStore | undefined,
  harness: Harness,
): ConnectionsApi {
  const owner = (connection: Connection) =>
    connection.kind === 'mcp' ? mcp : plugins
  const context = BACKGROUND_CONTEXT
  return {
    list: async () => {
      const policies =
        (await harness.snapshot(ToolPolicies, context)) ?? undefined
      return [...(await plugins.list()), ...(await mcp.list())].map(
        (info) =>
          ({
            ...info,
            ...(connectionPolicy(policies, info) && {
              policy: connectionPolicy(policies, info),
            }),
            tools: info.tools.map((tool) => {
              const { chosen, fallback } = policyOf(
                policies,
                info,
                tool.name,
                tool.annotations,
              )
              return {
                ...tool,
                ...(chosen && { policy: chosen }),
                default: fallback,
              }
            }),
          }) as ConnectionInfo,
      )
    },
    setPolicy: async (connection, tool, policy) => {
      // A tool is named, not checked: a server's tools come and go, and a
      // choice for one waits for it while it's disconnected.
      const exists = (await owner(connection).list()).some(
        (info) =>
          info.kind === connection.kind && info.name === connection.name,
      )
      if (!exists) {
        throw new ConnectionError(
          `There's no ${connection.kind} connection ${connection.name}.`,
        )
      }
      await harness.commit(
        (tx) => setPolicy(tx, connection, tool, policy),
        context,
      )
    },
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
