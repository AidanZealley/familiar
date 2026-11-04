import type { Op } from '@earendil-works/chord/delta'
import type { ConversationView } from '@earendil-works/pi-durable'
import type { AccountState } from '../account/index.ts'
import type { EpisodesState, FactsState } from '../memory/index.ts'
import type { SchedulesState } from '../schedules/index.ts'

// The wire contract every client speaks. Owned here; @familiar-ai/client imports
// these types, so a change to the API is a type error on both sides. Routes
// are typed by `HttpApi`; the event stream, which Hono's client can't type,
// by `StreamEvent`. The conversation is Pi's view as it is, so clients type
// it with Pi's own types.
export type {
  Author,
  MESSAGE_KIND,
  MessageData,
  StoredMessageData,
  ModelOption,
  SCHEDULED_KIND,
  ScheduledData,
} from '../conversation/index.ts'
export type { AgentState } from '@earendil-works/pi-durable'
export type { AccountState } from '../account/index.ts'
export type { Schedule, SchedulesState } from '../schedules/index.ts'
export type { PushHost, PushSubscriptionJson } from './push.ts'
export type { McpConnectionInfo, McpServer } from '../mcp/index.ts'
export type {
  Connection,
  ConnectionInfo,
  PluginSecret,
} from '../plugins/index.ts'
export type {
  Episode,
  EpisodesState,
  Fact,
  FactsState,
  MemoryHealth,
} from '../memory/index.ts'

/**
 * The documents mirrored live to clients, by name. Adding one is a line here
 * and a line in `/events`; clients mirror whatever arrives.
 */
export type Documents = {
  memory: FactsState
  episodes: EpisodesState
  schedules: SchedulesState
}

export type DocumentName = keyof Documents

/**
 * `GET /events` is a server-sent event stream of these. The conversation's
 * view and each document arrive whole first (again after any reconnect),
 * then as each commit's changes, to apply in order to the last value.
 */
export type StreamEvent =
  | { event: 'protocol'; data: { version: number } }
  | { event: 'view'; data: ConversationView }
  | { event: 'ops'; data: readonly Op[] }
  | {
      event: 'document'
      data: {
        [Name in DocumentName]: {
          name: Name
          value: Readonly<Documents[Name]> | null
        }
      }[DocumentName]
    }
  | { event: 'document.ops'; data: { name: DocumentName; ops: readonly Op[] } }
  /**
   * The owner's login, whole each time it changes; null once when the host
   * manages credentials itself and offers no sign-in.
   */
  | { event: 'account'; data: AccountState | null }
