import type { Extension } from '@earendil-works/pi-durable'
import type { Notify } from '../schedules/index.ts'
import { authorizedFetch } from './authorized-fetch.ts'
import { createConnections } from './connections.ts'
import type { SecretStore } from './secrets.ts'
import type { FamiliarPlugin, PluginFetch } from './types.ts'

export { ConnectionError, secretValue } from './connections.ts'
export { memorySecrets, type Connection, type SecretStore } from './secrets.ts'
export type {
  ConnectionInfo,
  ConnectionsApi,
  FamiliarPlugin,
  PluginContext,
  PluginFetch,
  PluginSecret,
} from './types.ts'

/** Identity, so a plugin's types are checked where it's written. */
export const definePlugin = (plugin: FamiliarPlugin) => plugin

export type PluginsOptions = {
  plugins: readonly FamiliarPlugin[]
  secrets?: SecretStore
  fetch?: PluginFetch
  notify?: Notify
  now: () => number
  timeZone: string
}

const unavailableFetch: PluginFetch = () =>
  Promise.reject(new Error('This Familiar has no network access for plugins.'))

/** Install Pi extensions with the host's network access and credentials. */
export function createPlugins(options: PluginsOptions) {
  const fetch = options.fetch ?? unavailableFetch
  const connections = createConnections(options.plugins, options.secrets)

  const extensions = options.plugins.map((plugin): Extension => {
    const connection = { kind: 'plugin' as const, name: plugin.name }
    const extension = plugin.extension({
      now: options.now,
      timeZone: options.timeZone,
      notify: options.notify ?? (async () => {}),
      fetch,
      authorizedFetch: async (name, input, init) =>
        authorizedFetch(
          fetch,
          connections.declaration(connection, name),
          () => connections.value(connection, name),
          input,
          init,
        ),
    })
    return {
      ...extension,
      name: `familiar.plugin.${plugin.name}`,
    }
  })
  return { extensions, api: connections.api }
}
