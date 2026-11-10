import type { Extension } from '@earendil-works/pi-durable'
import { defaultFetch } from '#default-fetch'
import type { Notify } from '../notify.ts'
import {
  authorizedFetch,
  checkDeclaration,
  type PluginFetch,
  type SecretStore,
} from '../connections/index.ts'
import { withServices, type ToolServices } from '../tools.ts'
import { createConnections } from './connections.ts'
import type { FamiliarPlugin } from './types.ts'

export type { FamiliarPlugin } from './types.ts'

/** Identity, so a plugin's types are checked where it's written. */
export const definePlugin = (plugin: FamiliarPlugin) => plugin

/**
 * Core's own tools. Pi runs the last tool registered under a name, so a
 * plugin's could silently replace one. `provide` refuses a core tool that
 * isn't listed, so the list can't fall behind.
 */
export const CORE_TOOLS: ReadonlySet<string> = new Set([
  'current_time',
  'recall',
  'read_memory',
  'remember',
  'revise_memory',
  'retire',
  'schedule',
  'list_schedules',
  'cancel_schedule',
])

/**
 * Throws, naming the plugin, unless these can run together: unique plugin
 * names, sendable secret declarations, and tool names that are neither
 * core's nor another plugin's. `openWorkspace` checks its plugins with it;
 * a host that loads plugins one by one can check each before accepting it.
 */
export function checkPlugins(plugins: readonly FamiliarPlugin[]) {
  const names = new Set<string>()
  const tools = new Map<string, string>()
  for (const plugin of plugins) {
    if (names.has(plugin.name)) {
      throw new Error(`Two plugins are named ${plugin.name}.`)
    }
    names.add(plugin.name)
    for (const secret of plugin.secrets ?? []) {
      checkDeclaration(plugin.name, secret)
    }
    for (const { name } of plugin.tools) {
      if (CORE_TOOLS.has(name)) {
        throw new Error(
          `${plugin.name}'s tool ${name} has the name of one of Familiar's own.`,
        )
      }
      const other = tools.get(name)
      if (other) {
        throw new Error(
          `${other} and ${plugin.name} both have a tool named ${name}.`,
        )
      }
      tools.set(name, plugin.name)
    }
  }
}

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
  checkPlugins(options.plugins)
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
    provide: (extension: Extension) => {
      for (const { name } of extension.tools ?? []) {
        if (!CORE_TOOLS.has(name)) {
          throw new Error(`Add core's tool ${name} to CORE_TOOLS.`)
        }
      }
      return provide(extension)
    },
    extensions: options.plugins.map((plugin) =>
      provide(
        { name: `familiar.plugin.${plugin.name}`, tools: plugin.tools },
        plugin,
      ),
    ),
    api: connections.api,
  }
}
