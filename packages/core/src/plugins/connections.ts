import { checkDeclaration } from './authorized-fetch.ts'
import type { Connection, SecretStore } from './secrets.ts'
import type { ConnectionsApi, FamiliarPlugin } from './types.ts'

export class ConnectionError extends Error {}

/**
 * A secret's value as it will be sent, or undefined if it can't be. Headers
 * trim surrounding whitespace, so the stored value must already be trimmed,
 * or redaction would look for something other than what was sent. Visible
 * ASCII only: what API keys and tokens are, and safe in any header.
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
    setSecret: async (connection, name, value) => {
      declared(connection, name)
      if (!store) {
        throw new Error('This host keeps no secrets.')
      }
      const sendable = secretValue(value)
      if (sendable === undefined) {
        throw new Error('A secret must be visible ASCII characters.')
      }
      await store.set(connection, name, sendable)
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
