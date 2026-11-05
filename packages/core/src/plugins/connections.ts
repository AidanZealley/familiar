import { checkDeclaration } from './authorized-fetch.ts'
import type { Connection, SecretStore } from './secrets.ts'
import type { ConnectionsApi, FamiliarPlugin } from './types.ts'

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

/** Owns credential declarations, storage and the Connections API. */
export function createConnections(
  plugins: readonly FamiliarPlugin[],
  store?: SecretStore,
) {
  const byName = new Map<string, FamiliarPlugin>()
  for (const plugin of plugins) {
    if (byName.has(plugin.name)) {
      throw new Error(`Two plugins are named ${plugin.name}.`)
    }
    byName.set(plugin.name, plugin)
    for (const secret of plugin.secrets ?? []) {
      checkDeclaration(plugin.name, secret)
    }
  }

  const declared = (connection: Connection, name: string) => {
    const plugin =
      connection.kind === 'plugin' ? byName.get(connection.name) : undefined
    const secret = plugin?.secrets?.find((secret) => secret.name === name)
    if (!plugin || !secret) {
      throw new ConnectionError(
        `${connection.kind} ${connection.name} has no secret ${name}.`,
      )
    }
    return { plugin, secret }
  }

  const api: ConnectionsApi = {
    list: () =>
      Promise.all(
        plugins.map(async (plugin) => ({
          kind: 'plugin' as const,
          name: plugin.name,
          title: plugin.title,
          secrets: await Promise.all(
            (plugin.secrets ?? []).map(async (secret) => ({
              name: secret.name,
              label: secret.label,
              help: secret.help,
              origin: secret.sendAs.origin,
              set: Boolean(
                await store?.get(
                  { kind: 'plugin', name: plugin.name },
                  secret.name,
                ),
              ),
            })),
          ),
        })),
      ),
    // allConnections has checked the value and that there is a store.
    setSecret: async (connection, name, value) => {
      declared(connection, name)
      await store?.set(connection, name, value)
    },
    deleteSecret: async (connection, name) => {
      declared(connection, name)
      await store?.delete(connection, name)
    },
  }

  return {
    api,
    declaration: (connection: Connection, name: string) =>
      declared(connection, name).secret,
    value: async (connection: Connection, name: string) => {
      const { plugin, secret } = declared(connection, name)
      const value = await store?.get(connection, name)
      if (!value) {
        throw new Error(
          `${plugin.title} isn't connected. Ask the owner to add ${secret.label} on the Connections page.`,
        )
      }
      return value
    },
  }
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
