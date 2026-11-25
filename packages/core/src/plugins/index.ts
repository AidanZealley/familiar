import type { Extension, ToolExecutionApi } from '@earendil-works/pi-durable'
import type { Context } from '@earendil-works/chord/context'
import type { QuestionsApi } from '../questions/index.ts'
import { familiarFor, type FamiliarId } from '../workspace/familiars.ts'
import type { ConnectionTool } from '../tool-runs/tools.ts'
import { defaultFetch } from '#default-fetch'
import type { Notify } from '../notify.ts'
import {
  authorizedFetch,
  checkDeclaration,
  type PluginFetch,
  type SecretStore,
} from '../connections/index.ts'
import { withServices, type FamiliarTool, type ToolServices } from '../tools.ts'
import { createConnections } from './connections.ts'
import { FAMILIAR_SECRET_PREFIX } from './familiar-secrets.ts'
import type { FamiliarPlugin } from './types.ts'

export { openPlugins } from './open.ts'
export {
  FAMILIAR_SECRET_PREFIX,
  familiarSecrets,
  type FamiliarSecrets,
} from './familiar-secrets.ts'
export { upgradeWebSocket } from './websocket.ts'
export type {
  FamiliarPlugin,
  FamiliarTool,
  PluginClose,
  PluginContext,
  PluginEnv,
} from './types.ts'

/** The extension a plugin's tools are installed as, once for every Familiar. */
export const pluginExtensionName = (plugin: string) =>
  `familiar.plugin.${plugin}`

/** Identity, so a plugin's types are checked where it's written. */
export const definePlugin = (plugin: FamiliarPlugin) => plugin

/**
 * Core's own tools. Pi runs the last tool registered under a name, so a
 * plugin's could silently replace one. `provide` refuses a core tool that
 * isn't listed, so the list can't fall behind.
 */
export const CORE_TOOLS: ReadonlySet<string> = new Set([
  'codemode',
  'current_time',
  'recall',
  'read_memory',
  'remember',
  'file',
  'tidy',
  'schedule',
  'list_schedules',
  'update_schedule',
  'cancel_schedule',
  'stay_quiet',
  'create_room',
  'add_to_room',
  'hand_off',
])

/**
 * Throws, naming the plugin, unless these can run together: unique plugin
 * names, sendable secret declarations outside `familiar/`, distinct Familiar secret names
 * without a `/`, and tool names that are neither
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
      if (secret.name.startsWith(FAMILIAR_SECRET_PREFIX)) {
        throw new Error(
          `${plugin.name}'s secret ${secret.name} can't start with ${FAMILIAR_SECRET_PREFIX}: Familiar secrets are kept there.`,
        )
      }
    }
    const familiarSecrets = plugin.familiarSecrets ?? []
    for (const [index, name] of familiarSecrets.entries()) {
      // Each is kept as `familiar/<id>/<name>`.
      if (!name || name.includes('/')) {
        throw new Error(
          `${plugin.name}'s Familiar secret name ${JSON.stringify(name)} must be non-empty, without a /.`,
        )
      }
      if (familiarSecrets.indexOf(name) !== index) {
        throw new Error(
          `${plugin.name} lists the Familiar secret ${name} twice.`,
        )
      }
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
  questions?: Pick<QuestionsApi, 'ask'>
  /** A Familiar's connection tools as it has them now (see `ToolRunsApi.list`). */
  connectionTools?: (familiar: FamiliarId) => Promise<ConnectionTool[]>
}

/**
 * Every tool's services, and plugins as Pi extensions. A plugin's tools may
 * send its own secrets; core's tools declare none.
 */
export function createPlugins(options: PluginsOptions) {
  checkPlugins(options.plugins)
  const fetch = options.fetch ?? defaultFetch
  const connections = createConnections(options.plugins, options.secrets)

  const services =
    (plugin?: FamiliarPlugin) =>
    (
      tool: Pick<FamiliarTool, 'name'>,
      api: ToolExecutionApi,
      context: Context,
    ): Omit<ToolServices, 'author' | 'familiarId'> => ({
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
      connectionTools: async () =>
        options.connectionTools?.(
          await api.commit(
            (tx) => familiarFor(tx, api.conversationId),
            context,
          ),
        ) ?? [],
      askPrivately: async ({ message, form }) => {
        if (!plugin || !options.questions) {
          throw new Error('Only a plugin tool can ask privately.')
        }
        const outcome = await options.questions.ask(
          {
            kind: 'private',
            familiar: await api.commit(
              (tx) => familiarFor(tx, api.conversationId),
              context,
            ),
            callId: api.callId.split('/')[0]!,
            tool: tool.name,
            plugin: plugin.title || plugin.name,
            message,
            form,
          },
          context,
        )
        return outcome.action === 'accept'
          ? { action: 'accept', values: outcome.content ?? {} }
          : { action: outcome.action }
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
        { name: pluginExtensionName(plugin.name), tools: plugin.tools },
        plugin,
      ),
    ),
    api: connections.api,
  }
}
