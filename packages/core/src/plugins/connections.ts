import {
  checkDeclaration,
  ConnectionError,
  type Connection,
  type ConnectionsApi,
  type SecretStore,
} from '../connections/index.ts'
import type { FamiliarPlugin } from './types.ts'

/** Plugins' half of the Connections API: their declared secrets and values. */
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
