import type { Harness } from '@earendil-works/pi-durable'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  toolSettingsOf,
  ToolSettingsDocument,
  updateToolSettings,
} from './tool-settings.ts'
import type { Connection, SecretStore } from './secrets.ts'
import type { ConnectionsApi, ConnectionsSource } from './types.ts'

/**
 * Connections: what plugins and MCP servers need from outside Familiar, the
 * secrets the owner sets for them, and how a secret is sent. Plugins and MCP
 * each own their side; this is what they share.
 */

export { authorizedFetch, checkDeclaration } from './authorized-fetch.ts'
export { memorySecrets } from './secrets.ts'
export type * from './types.ts'
export type { Connection, SecretStore } from './secrets.ts'
export type { ToolAnnotations, ToolSettings } from './tool-settings.ts'

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
 * Owns the tool settings for both.
 */
export function allConnections(
  plugins: ConnectionsSource,
  mcp: ConnectionsSource & Pick<ConnectionsApi, 'updateToolSettings'>,
  store: SecretStore | undefined,
  harness: Harness,
): ConnectionsApi {
  const owner = (connection: Connection) =>
    connection.kind === 'mcp' ? mcp : plugins
  const context = BACKGROUND_CONTEXT
  return {
    list: async () => {
      const settings = await harness.snapshot(ToolSettingsDocument, context)
      return [...(await plugins.list()), ...(await mcp.list())].map((info) => ({
        ...info,
        tools: info.tools.map((tool) => ({
          ...tool,
          ...toolSettingsOf(settings, info, tool.name, tool.annotations),
        })),
      }))
    },
    updateToolSettings: async (connection, tool, change) => {
      if (connection.kind === 'mcp') {
        return mcp.updateToolSettings(connection, tool, change)
      }
      if (change.runInBackground !== undefined) {
        throw new ConnectionError(
          'Background execution is available for MCP tools only.',
        )
      }
      const exists = (await plugins.list()).some(
        (info) =>
          info.kind === connection.kind && info.name === connection.name,
      )
      if (!exists) {
        throw new ConnectionError(
          `There's no ${connection.kind} connection ${connection.name}.`,
        )
      }
      await harness.commit(
        (tx) => updateToolSettings(tx, connection, tool, change),
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
