// Everything @familiar-ai/core exports from its root: opening a workspace,
// the types in its signatures, and what hosts and plugins build with.
export {
  CapabilityError,
  openWorkspace,
  type CapabilitiesChange,
  type FamiliarCapabilities,
  type FamiliarChange,
  type FamiliarId,
  type FamiliarIdentity,
  type FamiliarSummary,
  type FamiliarsState,
  type ModelDefaults,
  type ModelDefaultsChange,
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
  IMAGE_LIMITS,
  MESSAGE_LIMITS,
  MessageError,
  type Author,
} from './conversation/message.ts'
export type { HistoryQuery, HistoryPage } from './rooms/index.ts'
export {
  ModelError,
  type ModelChoice,
  type ModelOption,
  type ModelSetting,
} from './conversation/models.ts'
export type { MemoryApi } from './memory/index.ts'
export {
  MAX_DEPTH,
  REPLY_KIND,
  RoomError,
  type HandoffData,
  type Mention,
  type NoteData,
  type ReplyData,
  type Room,
  type RoomApi,
  type RoomChange,
  type RoomId,
  type RoomMessage,
  type RoomMessageData,
  type RoomSetup,
  type RoomsApi,
  type RoomSummary,
  type RoomActivity,
  type TurnActivity,
  type RoomListing,
  type RoomPreview,
  type RoomsState,
  type RoomTurn,
} from './rooms/index.ts'
export { defaultPersona } from './persona.ts'
export {
  DEFAULT_MAX_SCHEDULES,
  SCHEDULE_LIMITS,
  type SchedulesApi,
} from './schedules/index.ts'
export type { Notification, NotificationContext, Notify } from './notify.ts'
export { localMinute } from './time.ts'

export * as schema from '@earendil-works/pi-schema'

// Extending Familiar: tools, plugins, their connections and MCP servers.
export {
  defineTool,
  familiar,
  type ToolContext,
  type ToolResult,
  type ToolDetails,
  type ToolServices,
} from './tools.ts'
export {
  checkPlugins,
  definePlugin,
  type FamiliarPlugin,
  type FamiliarSecrets,
  type FamiliarTool,
  type PluginClose,
  type PluginContext,
  type PluginEnv,
  upgradeWebSocket,
} from './plugins/index.ts'
export {
  ConnectionError,
  memorySecrets,
  secretValue,
  type Connection,
  type ConnectionInfo,
  type ConnectionsApi,
  type PluginFetch,
  type PluginSecret,
  type SecretStore,
  type ToolAnnotations,
  type ToolSettings,
  type ToolInfo,
} from './connections/index.ts'
export {
  QuestionError,
  QuestionGone,
  type Answer,
  type Form,
  type FormField,
  type Question,
} from './questions/index.ts'
export {
  McpConfigError,
  type McpApi,
  type McpConnectionInfo,
  type McpServer,
  type McpStdioFactory,
  type McpStdioTransport,
} from './mcp/servers.ts'
