// Everything @familiar-ai/core exports from its root: summoning a Familiar,
// the types in its signatures, and what hosts and plugins build with.
export {
  summonFamiliar,
  type Familiar,
  type FamiliarOptions,
} from './familiar.ts'
export {
  openWorkspace,
  type FamiliarId,
  type FamiliarSummary,
  type Workspace,
  type WorkspaceFamiliar,
  type WorkspaceOptions,
} from './workspace/index.ts'
export type {
  SessionEnd as FamiliarEnd,
  UsageState as Usage,
  Wake,
  ModelRef,
  Storage,
} from '@earendil-works/pi-durable'
export type { ModelThinkingLevel } from '@earendil-works/pi-ai'
export type {
  AccountApi,
  AccountOptions,
  AccountState,
} from './account/index.ts'
export {
  MESSAGE_LIMITS,
  MessageError,
  type Author,
} from './conversation/message.ts'
export type { HistoryPage, Message } from './conversation/index.ts'
export {
  ModelError,
  type ChatModel,
  type ModelOption,
} from './conversation/models.ts'
export type { MemoryApi } from './memory/index.ts'
export { defaultPersona } from './persona.ts'
export {
  DEFAULT_MAX_SCHEDULES,
  SCHEDULE_LIMITS,
  type SchedulesApi,
} from './schedules/index.ts'
export type { Notification, NotificationContext, Notify } from './notify.ts'
export { localMinute } from './time.ts'

// Extending Familiar: tools, plugins, their connections and MCP servers.
export {
  defineTool,
  familiar,
  Type,
  type Static,
  type TSchema,
  type ToolContext,
  type ToolResult,
  type ToolDetails,
  type ToolServices,
} from './tools.ts'
export {
  checkPlugins,
  definePlugin,
  type FamiliarPlugin,
} from './plugins/index.ts'
export {
  ConnectionError,
  memorySecrets,
  type Connection,
  type ConnectionInfo,
  type ConnectionsApi,
  type PluginFetch,
  type PluginSecret,
  type SecretStore,
} from './connections/index.ts'
export {
  McpConfigError,
  type McpApi,
  type McpConnectionInfo,
  type McpServer,
  type McpStdioFactory,
  type McpStdioTransport,
} from './mcp/servers.ts'
