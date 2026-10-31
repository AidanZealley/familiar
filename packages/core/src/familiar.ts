import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Models } from '@earendil-works/pi-ai'
import {
  createRegistry,
  Harness,
  type HarnessOptions,
  type ModelRef,
  type Storage,
  type UsageState,
} from '@earendil-works/pi-durable'
import { createAccount, type AccountApi } from './account/index.ts'
import { DEFAULT_CONTEXT_BUDGET, harnessOptions } from './context/index.ts'
import {
  findChatModel,
  installConversation,
  modelKey,
  type ChatModel,
  type ConversationApi,
} from './conversation/index.ts'
import { createMemory, type MemoryApi } from './memory/index.ts'
import { createPersona } from './persona/index.ts'
import { createMcp } from './mcp/manager.ts'
import type { McpApi, McpStdioFactory } from './mcp/types.ts'
import {
  createPlugins,
  type ConnectionsApi,
  type FamiliarPlugin,
  type PluginFetch,
  type SecretStore,
} from './plugins/index.ts'
import {
  createSchedules,
  type Notify,
  type SchedulesApi,
} from './schedules/index.ts'
import { checkTimeZone, createTime } from './time/index.ts'

// The types in Familiar's own signatures, so hosts can name them.
export type { AccountApi, AccountState } from './account/index.ts'
export {
  ModelError,
  type ChatModel,
  type HistoryPage,
  type Message,
  type ModelOption,
} from './conversation/index.ts'
export type { MemoryApi } from './memory/index.ts'
export type { McpApi, McpConnectionInfo, McpStdioFactory } from './mcp/types.ts'
export type { McpServer, McpStdioTransport } from './mcp/servers.ts'
export type { Notification, SchedulesApi } from './schedules/index.ts'
export {
  ConnectionError,
  definePlugin,
  memorySecrets,
  type Connection,
  type ConnectionInfo,
  type ConnectionsApi,
  type FamiliarPlugin,
  type PluginContext,
  type PluginFetch,
  type PluginSecret,
  type SecretStore,
} from './plugins/index.ts'
export { localMinute } from './time/index.ts'
export type { UsageState as Usage } from '@earendil-works/pi-durable'

export type FamiliarOptions = {
  storage: Storage
  models: Models
  /**
   * What memory upkeep runs on, at its level in `chatModels`, and what the
   * conversation starts on until the owner picks another.
   */
  model: ModelRef
  /**
   * The owner's IANA time zone, such as `Europe/London`. Familiar reads every
   * calendar in it: dates in memory, the days upkeep files and its 04:00
   * pass, schedules' times and repeats, and current_time's answer. Instants
   * (`now`) don't depend on it. Pass the same zone on every open; see
   * docs/architecture.md for what changes when it differs.
   */
  timeZone: string
  /**
   * The models the owner may switch the conversation between, each with the
   * level it starts on. Must include `model`. Default: only `model`, at
   * medium.
   */
  chatModels?: readonly ChatModel[]
  name?: string
  /**
   * This installation's stable ID, the same on every call. Signing in to
   * ChatGPT needs it; OpenAI identifies the app's logins by it.
   */
  deviceId?: () => string
  /** Everything beyond core: tools, sections and hooks, with their secrets. */
  plugins?: readonly FamiliarPlugin[]
  /** Where plugins' secrets are kept. Without it, every secret is missing. */
  secrets?: SecretStore
  /**
   * How plugins reach the network. A model can be talked into fetching any
   * URL, so if this process can reach private, loopback or tailnet addresses,
   * this must refuse them, at connection time and on every redirect. A
   * Cloudflare Worker can't reach them, so it passes its own `fetch`.
   * Without one, plugins' fetches fail.
   */
  fetch?: PluginFetch
  /** Owner-configured MCP endpoints, including private networks. Never used by plugins. */
  mcpFetch?: PluginFetch
  /** Optional host factory for owner-configured local MCP commands. */
  mcpStdio?: McpStdioFactory
  /**
   * Roughly how many tokens each request may send, whatever the model's context
   * window; older conversation is compacted into a summary to stay under it.
   * Higher keeps more conversation verbatim, but every request pays for all of
   * it, in money or subscription limits, latency and the model's attention.
   * Default 64,000.
   */
  contextBudget?: number
  /**
   * Shows the owner a notification: each scheduled run's reply, or its
   * prompt if there was none. Without it, schedules still run in the
   * conversation. Hosts deliver it however suits them, such as Web Push.
   */
  notify?: Notify
  now?: HarnessOptions['now']
  setTimer?: HarnessOptions['setTimer']
}

/**
 * A Familiar is one assistant with one owner and one never-ending conversation.
 * A host that serves many owners (households, users) opens one Familiar each.
 */
export type Familiar = ConversationApi & {
  /** The owner's login with the models' provider. */
  account: AccountApi
  memory: MemoryApi
  schedules: SchedulesApi
  connections: ConnectionsApi
  mcp: McpApi
  /**
   * Called after every commit. Listeners run synchronously, so keep them quick
   * and don't call back into Familiar. Returns a function that stops listening.
   */
  onCommit(listener: () => void): () => void
  usage(): Promise<UsageState>
  dismiss(): Promise<void>
}

/**
 * Opens a Familiar over its storage, resuming whatever it was doing, and
 * starts its background work. One process per storage; `dismiss()` it when done.
 */
export async function summonFamiliar(
  options: FamiliarOptions,
): Promise<Familiar> {
  const context = BACKGROUND_CONTEXT
  const name = options.name ?? 'Familiar'
  const budget = options.contextBudget ?? DEFAULT_CONTEXT_BUDGET
  const chatModels = options.chatModels ?? [
    { model: options.model, thinkingLevel: 'medium' },
  ]
  checkTimeZone(options.timeZone)
  const model = findChatModel(chatModels, options.model)
  if (!model) {
    throw new Error(`${modelKey(options.model)} must be one of chatModels.`)
  }

  // Extensions can be installed after opening: nothing runs until resume().
  const registry = createRegistry()

  const harness = await Harness.open(
    options.storage,
    harnessOptions({ ...options, chatModels }, registry, budget),
    context,
  )

  // Half the budget leaves room for the prompt, memory and the pass's tool calls.
  const memory = createMemory(harness, {
    now: options.now ?? Date.now,
    model: options.model,
    thinkingLevel: model.thinkingLevel,
    name,
    transcriptTokens: Math.floor(budget / 2),
    timeZone: options.timeZone,
  })

  const schedules = createSchedules({
    name,
    notify: options.notify,
    timeZone: options.timeZone,
  })

  const account = await createAccount({
    models: options.models,
    provider: options.model.provider,
    login: { getDeviceId: options.deviceId, agentName: name },
  })

  const plugins = createPlugins({
    plugins: options.plugins ?? [],
    secrets: options.secrets,
    fetch: options.fetch,
    notify: options.notify,
    now: options.now ?? Date.now,
    timeZone: options.timeZone,
  })

  // Plugins last, so core's tools and sections come first.
  const extensions = [
    createPersona(name),
    account.extension,
    createTime(options.timeZone),
    ...memory.extensions,
    schedules.extension,
    ...plugins.extensions,
  ]

  for (const extension of extensions) {
    registry.install(extension)
  }

  const conversation = await installConversation(harness, {
    models: options.models,
    model: options.model,
    chatModels,
  })
  const memoryActions = await memory.start()
  const scheduleActions = await schedules.start(harness)
  const mcp = await createMcp(harness, registry, {
    fetch: options.mcpFetch,
    stdio: options.mcpStdio,
    secrets: options.secrets,
  })

  // finish whatever the last process left unfinished
  harness.resume()

  return {
    ...conversation,
    account: account.api,
    memory: memoryActions,
    schedules: scheduleActions,
    mcp: mcp.api,
    connections: {
      list: async () => [
        ...(await plugins.api.list()),
        ...(await mcp.connections.list()),
      ],
      setSecret: (connection, name, value) =>
        (connection.kind === 'mcp' ? mcp.connections : plugins.api).setSecret(
          connection,
          name,
          value,
        ),
      deleteSecret: (connection, name) =>
        (connection.kind === 'mcp'
          ? mcp.connections
          : plugins.api
        ).deleteSecret(connection, name),
    },
    onCommit: (listener) => harness.subscribeCommits(() => listener()),
    usage: () => harness.usage(context),
    dismiss: async () => {
      try {
        await harness.close(context)
      } finally {
        await mcp.close()
      }
    },
  }
}
