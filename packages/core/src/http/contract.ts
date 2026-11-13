import type { Op } from '@earendil-works/chord/delta'
import type { AgentState, ConversationView } from '@earendil-works/pi-durable'
import type { AccountState } from '../account/index.ts'
import type { MemoryState } from '../memory/index.ts'
import type { Author } from '../conversation/message.ts'
import type { RoomActivity, RoomsState } from '../rooms/index.ts'
import type { SchedulesState } from '../schedules/index.ts'
import type { FamiliarsState } from '../workspace/index.ts'

// The wire contract every client speaks. Owned here; @familiar-ai/client imports
// these types, so a change to the API is a type error on both sides. Routes
// are typed by `HttpApi`; the event stream, which Hono's client can't type,
// by `StreamEvent`. A room's log is Pi's view as it is, so clients type it
// with Pi's own types.
export type {
  Author,
  HANDOFF_KIND,
  MESSAGE_KIND,
  NOTE_KIND,
  SCHEDULED_KIND,
} from '../conversation/message.ts'
export type { HistoryPage } from '../pi/entries.ts'
export type {
  HandoffData,
  Mention,
  NoteData,
  REPLY_KIND,
  ReplyData,
  Room,
  RoomActivity,
  RoomId,
  RoomListing,
  RoomMessageData,
  RoomPreview,
  RoomScheduledData,
  RoomsState,
  RoomSummary,
  RoomTurn,
  TurnActivity,
} from '../rooms/index.ts'
export type {
  CapabilitiesChange,
  FamiliarCapabilities,
  FamiliarId,
  FamiliarIdentity,
  FamiliarsState,
  FamiliarSummary,
} from '../workspace/index.ts'
export type { ModelOption } from '../conversation/models.ts'
export type { AgentState } from '@earendil-works/pi-durable'
export type { AccountState } from '../account/index.ts'
export type { Schedule, SchedulesState } from '../schedules/index.ts'
export type { PushHost, PushSubscriptionJson } from './push.ts'
export type { McpConnectionInfo, McpServer } from '../mcp/servers.ts'
export type {
  Connection,
  ConnectionInfo,
  PluginSecret,
} from '../connections/index.ts'
export type {
  JournalLine,
  MemoryState,
  Note,
  NoteKind,
  PageState,
  PageView,
  Participant,
  Retired,
  Standing,
  Subject,
  SubjectKind,
} from '../memory/index.ts'

/**
 * The documents mirrored live to clients, by name. Adding one is a line here
 * and a source in a stream; clients mirror whatever arrives.
 */
export type Documents = {
  /** The workspace's `/events`: who each Familiar is. */
  familiars: FamiliarsState
  /**
   * The workspace's `/events`: the rooms the person sees, each with its
   * newest entry, what they haven't read and its turns in progress.
   */
  rooms: RoomsState
  /** The workspace's `/events`: the person asking, as Familiars know them. */
  me: Author
  /** A Familiar's `/events`: the model its chat is on, and the level. */
  model: AgentState
  /** A Familiar's `/events`: its memory's subjects, which the roster and pages list. */
  memory: MemoryState
  schedules: SchedulesState
  /** A room's `/events`: its turns in progress, live. */
  turns: RoomActivity
}

export type DocumentName = keyof Documents

/**
 * Opens every event stream. A client that speaks another version stops
 * before applying any state; bump it on any change an older client would
 * misread.
 */
export const PROTOCOL_VERSION = 6

/**
 * Each `/events` (the workspace's, a Familiar's and a room's) is a
 * server-sent event stream of these. A room's log view and each document
 * arrive whole first (again after any reconnect), then as each commit's
 * changes, to apply in order to the last value.
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
