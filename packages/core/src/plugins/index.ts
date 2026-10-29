import type { Extension } from '@earendil-works/pi-durable'
import type { Notify } from '../schedules/index.ts'
import { authorizedFetch } from './authorized-fetch.ts'
import { createConnections } from './connections.ts'
import type { SecretStore } from './secrets.ts'
import type { FamiliarPlugin, PluginFetch, PluginProtection } from './types.ts'

export { ConnectionError, secretValue } from './connections.ts'
export { memorySecrets, type Connection, type SecretStore } from './secrets.ts'
export type {
  ConnectionInfo,
  ConnectionsApi,
  FamiliarPlugin,
  PluginContext,
  PluginFetch,
  PluginProtection,
  PluginSecret,
} from './types.ts'

/** Identity, so a plugin's types are checked where it's written. */
export const definePlugin = (plugin: FamiliarPlugin) => plugin

export type PluginsOptions = {
  plugins: readonly FamiliarPlugin[]
  secrets?: SecretStore
  fetch?: PluginFetch
  protection?: PluginProtection
  notify?: Notify
  now: () => number
}

const unavailableFetch: PluginFetch = () =>
  Promise.reject(new Error('This Familiar has no network access for plugins.'))

/** Install plugins with host-supplied network access and optional protection. */
export function createPlugins(options: PluginsOptions) {
  const access = {
    fetch: options.fetch ?? unavailableFetch,
    secrets: options.secrets,
  }
  const protectedAccess = options.protection?.({
    ...access,
    credentials: options.plugins.flatMap((plugin) =>
      (plugin.secrets ?? []).map(({ name }) => ({
        connection: { kind: 'plugin' as const, name: plugin.name },
        secret: name,
      })),
    ),
  })
  const { fetch, secrets } = protectedAccess ?? access
  const connections = createConnections(options.plugins, secrets)

  const extensions = options.plugins.map((plugin): Extension => {
    const connection = { kind: 'plugin' as const, name: plugin.name }
    const extension = plugin.extension({
      now: options.now,
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
      tools: protectedAccess
        ? extension.tools?.map((tool) => protectedAccess.wrapTool(tool))
        : extension.tools,
    }
  })
  return { extensions, api: connections.api }
}
