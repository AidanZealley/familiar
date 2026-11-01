import { applyImmutable } from '@earendil-works/chord/delta'
import type {
  AgentState,
  ConversationView,
  EntryRecord,
} from '@earendil-works/pi-durable'
import type { AccountState, Documents } from '@familiar-ai/core/http'
import { createStore } from 'zustand/vanilla'
import type { Transcript } from './transcript.ts'
import { createCommands, type Commands } from './commands.ts'
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

export type FamiliarState = {
  connection: Connection
  account: Commands['account'] & {
    /** Undefined until the first frame; null when the host manages credentials. */
    state: AccountState | null | undefined
  }
  conversation: Commands['conversation'] & {
    view: ConversationView | undefined
    history: History
    /** Concurrent callers share the current page request. */
    loadOlder(): Promise<boolean>
  }
  memory: Commands['memory'] & {
    /** Streamed documents, undefined until received. */
    facts: Readonly<Documents['memory']> | null | undefined
    episodes: Readonly<Documents['episodes']> | null | undefined
  }
  schedules: Commands['schedules'] & {
    items: Readonly<Documents['schedules']> | null | undefined
  }
  push: Commands['push']
  connections: Commands['connections']
  mcp: Commands['mcp']
  /** Cached atomically with the conversation; unchanged by unrelated updates. */
  transcript: Transcript | undefined
  /** Closes the stream and pending reconnects, retaining the last state. */
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
    events.on('account', (state) =>
      set(({ account }) => ({ account: { ...account, state } })),
    )
    events.on('document', ({ name, value }) => {
      switch (name) {
        case 'memory':
          set(({ memory }) => ({ memory: { ...memory, facts: value } }))
          break
        case 'episodes':
          set(({ memory }) => ({ memory: { ...memory, episodes: value } }))
          break
        case 'schedules':
          set(({ schedules }) => ({
            schedules: { ...schedules, items: value },
          }))
          break
      }
    })
    events.on('document.ops', ({ name, ops }) => {
      switch (name) {
        case 'memory':
          set(({ memory }) => ({
            memory: {
              ...memory,
              facts: applyImmutable(memory.facts ?? undefined, ops),
            },
          }))
          break
        case 'episodes':
          set(({ memory }) => ({
            memory: {
              ...memory,
              episodes: applyImmutable(memory.episodes ?? undefined, ops),
            },
          }))
          break
        case 'schedules':
          set(({ schedules }) => ({
            schedules: {
              ...schedules,
              items: applyImmutable(schedules.items ?? undefined, ops),
            },
          }))
          break
      }
    })
    return {
      connection: 'connecting',
      ...commands,
      account: { ...commands.account, state: undefined },
      conversation: {
        ...commands.conversation,
        view: undefined,
        history: { entries: [], status: 'more' },
        loadOlder: conversation.loadOlder,
      },
      memory: { ...commands.memory, facts: undefined, episodes: undefined },
      schedules: { ...commands.schedules, items: undefined },
      transcript: undefined,
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
