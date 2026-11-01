import { applyImmutable } from '@earendil-works/chord/delta'
import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type {
  AgentState,
  ConversationView,
  EntryRecord,
  ModelRef,
} from '@earendil-works/pi-durable'
import type {
  AccountState,
  Connection as ConnectionKey,
  ConnectionInfo,
  DocumentName,
  Documents,
  McpServer,
  MemoryHealth,
  ModelOption,
  PushSubscriptionJson,
} from '@familiar-ai/core/http'
import { createStore } from 'zustand/vanilla'
import type { Transcript } from './transcript.ts'
import { createCommands } from './commands.ts'
import { createConversation } from './conversation.ts'
import { openEvents } from './events.ts'
export { carryOver, startOf } from './conversation.ts'

/**
 * The event stream's state. It goes `open` when a full view arrives.
 * `reconnecting` follows a network error, a stream that ended, or a 5xx or
 * 429 answer, and retries after the server's `retry` delay (3 seconds unless
 * it sets one). `outdated` stops retrying on an incompatible or missing
 * protocol handshake before state arrives. The host decides when to reload.
 * Other terminal states are: `unauthorized` when the stream is
 * answered 401 or 403, and `failed` for any other answer it can't use, such
 * as a 404 or a page that isn't an event stream. To recover from either,
 * disconnect and create a new store.
 */
export type Connection =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'unauthorized'
  | 'failed'
  | 'outdated'

export type FamiliarStoreOptions = {
  /**
   * Makes every request: each API call, the event stream, and each of the
   * stream's reconnects, so a host can attach a fresh credential each time.
   * It gets the URL and an init with the method, body, headers and abort
   * signal to pass on. Defaults to the platform's `fetch`.
   */
  fetch?: typeof fetch
}

/** The conversation before the view, as far back as it has been loaded. */
export type History = {
  /** Committed entries older than any in the view, oldest first. */
  entries: readonly EntryRecord[]
  /**
   * `start` once `entries` reaches the start of the conversation; `failed`
   * if the last load did, until the next one.
   */
  status: 'more' | 'loading' | 'failed' | 'start'
}

/**
 * Every document the server streams, such as `memory` and `episodes`,
 * mirrored like the view under its own name. Undefined until it arrives.
 */
export type MirroredDocuments = {
  [Name in DocumentName]?: Readonly<Documents[Name]> | null
}

export type FamiliarState = MirroredDocuments & {
  connection: Connection
  /**
   * The owner's login with the models' provider: null when the server offers
   * no sign-in because its host manages credentials, undefined until the
   * first frame.
   */
  account: AccountState | null | undefined
  /** Starts signing in; the page to open, and any code, arrive in `account`. */
  signIn(): Promise<void>
  /** The address the browser ended on, when `account` asks to paste it. */
  answerSignIn(text: string): Promise<void>
  cancelSignIn(): Promise<void>
  signOut(): Promise<void>
  /** The server's view of the conversation, mirrored exactly. Absent until the first frame. */
  view: ConversationView | undefined
  history: History
  /**
   * Chat items and activity, absent until the first view. Keeps its reference
   * while the view and loaded history entries are unchanged.
   */
  transcript: Transcript | undefined
  /**
   * Load the page of entries before the oldest the store has. Resolves to
   * whether older ones remain; a call while one is loading shares its result.
   */
  loadOlder(): Promise<boolean>
  send(text: string): Promise<void>
  abort(): Promise<void>
  /** The models the conversation may switch to; `agentOf` says which it's on. */
  modelOptions(): Promise<ModelOption[]>
  setModel(model: ModelRef): Promise<void>
  /** Changes the current model's level, remembered for that model. */
  setThinkingLevel(level: ModelThinkingLevel): Promise<void>
  reviseFact(id: string, text: string): Promise<void>
  retireFact(id: string): Promise<void>
  setFactPinned(id: string, pinned: boolean): Promise<void>
  cancelSchedule(id: string): Promise<void>
  /** The key to subscribe to push with, or undefined if the server has no push. */
  pushKey(): Promise<string | undefined>
  subscribePush(subscription: PushSubscriptionJson): Promise<void>
  unsubscribePush(subscription: PushSubscriptionJson): Promise<void>
  /** Every connection and whether each secret is set. Never values. */
  connections(): Promise<ConnectionInfo[]>
  /** Memory's health numbers, measured when asked. */
  memoryHealth(): Promise<MemoryHealth>
  setSecret(
    connection: ConnectionKey,
    secret: string,
    value: string,
  ): Promise<void>
  deleteSecret(connection: ConnectionKey, secret: string): Promise<void>
  /** Saves an MCP server, which then connects in the background. */
  addMcpServer(server: McpServer): Promise<void>
  removeMcpServer(name: string): Promise<void>
  reconnectMcpServer(name: string): Promise<void>
  /**
   * Closes the stream and cancels any reconnect, including one waiting on the
   * host's fetch. The store keeps its last state. Commands already sent still
   * settle with their callers.
   */
  disconnect(): void
}

/**
 * A live mirror of one Familiar's conversation. Framework-free: use it with
 * `useStore` from zustand in React, or `subscribe` anywhere else.
 *
 * A command that fails rejects with the server's reason and is never sent
 * again. Only the stream retries, and only by reconnecting.
 *
 * @param baseUrl Where the HTTP API is mounted: `/api`, or a full URL.
 */
export function createFamiliarStore(
  baseUrl: string,
  options: FamiliarStoreOptions = {},
) {
  // Looks the global up on each call, so a later polyfill or stub counts.
  const fetch: typeof globalThis.fetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const store = createStore<FamiliarState>()((set, get) => {
    const { commands, history } = createCommands(baseUrl, fetch)
    const conversation = createConversation(set, get, history)
    const events = openEvents(baseUrl, fetch, (connection) =>
      set({ connection }),
    )
    events.on('view', (view) =>
      set({ ...conversation.receive(view), connection: 'open' }),
    )
    events.on('ops', (ops) => set(conversation.apply(ops)))
    events.on('account', (account) => set({ account }))
    events.on('document', ({ name, value }) => set({ [name]: value }))
    events.on('document.ops', ({ name, ops }) =>
      set((state) => ({
        [name]: applyImmutable(state[name] ?? undefined, ops),
      })),
    )
    return {
      connection: 'connecting',
      account: undefined,
      view: undefined,
      history: { entries: [], status: 'more' },
      transcript: undefined,
      ...commands,
      loadOlder: conversation.loadOlder,
      disconnect: events.disconnect,
    }
  })

  return {
    getState: store.getState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe,
  }
}

export type FamiliarStore = ReturnType<typeof createFamiliarStore>

/** The conversation's model and reasoning level, as Pi stores them. */
export const agentOf = (view: ConversationView | undefined) =>
  view?.docs['pi.agent'] as AgentState | undefined
