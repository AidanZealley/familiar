import type { Extension } from '@earendil-works/pi-durable'
import { defaultFetch } from '#default-fetch'
import type { Notify } from '../notify.ts'
import {
  authorizedFetch,
  type PluginFetch,
  type SecretStore,
} from '../connections/index.ts'
import { withServices, type ToolServices } from '../tools.ts'
import { createConnections } from './connections.ts'
import type { FamiliarPlugin } from './types.ts'

export type { FamiliarPlugin } from './types.ts'

/** Identity, so a plugin's types are checked where it's written. */
export const definePlugin = (plugin: FamiliarPlugin) => plugin

export type PluginsOptions = {
  plugins: readonly FamiliarPlugin[]
  secrets?: SecretStore
  fetch?: PluginFetch
  notify?: Notify
  timeZone: string
}

/**
 * Every tool's services, and plugins as Pi extensions. A plugin's tools may
 * send its own secrets; core's tools declare none.
 */
export function createPlugins(options: PluginsOptions) {
  const fetch = options.fetch ?? defaultFetch
  const connections = createConnections(options.plugins, options.secrets)

  const services = (plugin?: FamiliarPlugin): Omit<ToolServices, 'author'> => ({
    timeZone: options.timeZone,
    // Without a schedule's context: tools can't claim one.
    notify: async (notification) => options.notify?.(notification),
    fetch,
    authorizedFetch: async (name, input, init) => {
      if (!plugin) {
        throw new Error(`Only a plugin's tools can send its secrets.`)
      }
      const connection = { kind: 'plugin' as const, name: plugin.name }
      return authorizedFetch(
        fetch,
        connections.declaration(connection, name),
        () => connections.value(connection, name),
        input,
        init,
      )
    },
  })

  const provide = (extension: Extension, plugin?: FamiliarPlugin) => {
    const provided = services(plugin)
    return {
      ...extension,
      tools: extension.tools?.map((tool) => withServices(tool, provided)),
    }
  }

  return {
    /** Core's own extensions, their tools given services. */
    provide: (extension: Extension) => provide(extension),
    extensions: options.plugins.map((plugin) =>
      provide(
        { name: `familiar.plugin.${plugin.name}`, tools: plugin.tools },
        plugin,
      ),
    ),
    api: connections.api,
  }
}
