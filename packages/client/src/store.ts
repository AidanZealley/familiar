import { applyImmutable } from '@earendil-works/chord/delta'
import type { ConversationView, EntryRecord } from '@earendil-works/pi-durable'
import type {
  AccountState,
  DocumentName,
  Documents,
} from '@familiar-ai/core/http'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { createCommands, type Commands } from './commands.ts'
import { createConversation } from './conversation.ts'
import { openEvents } from './events.ts'
import type { Transcript } from './transcript.ts'

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

/** What the event stream has sent, as plain data. */
export type FamiliarState = {
  connection: Connection
  /** Undefined until the first frame; null when the host manages credentials. */
  account: AccountState | null | undefined
  view: ConversationView | undefined
  history: History
  /** Derived with the view and history; unchanged by unrelated updates. */
  transcript: Transcript | undefined
} & {
  /** Each streamed document under its wire name, undefined until received. */
  [Name in DocumentName]: Readonly<Documents[Name]> | null | undefined
}

/**
 * Read state with `getState` and `subscribe`, or `useStore` from zustand.
 * Change it only through the commands, which never change identity.
 */
export type FamiliarStore = Pick<
  StoreApi<FamiliarState>,
  'getState' | 'getInitialState' | 'subscribe'
> &
  Commands & {
    conversation: {
      /**
       * Loads the next older page into `history`. Its `status` shows
       * progress and failure, so this never rejects.
       */
      loadOlder(): Promise<void>
    }
    /** Closes the stream and pending reconnects, retaining the last state. */
    disconnect(): void
  }

/**
 * A live mirror of one Familiar. Framework-free: subscribe anywhere, or use
 * the React bindings.
 *
 * A command that fails rejects with the server's reason and is never sent
 * again. Only the stream retries, and only by reconnecting.
 *
 * @param baseUrl Where the HTTP API is mounted: `/api`, or a full URL.
 */
export function createFamiliarStore(
  baseUrl: string,
  options: FamiliarStoreOptions = {},
): FamiliarStore {
  // Calls the global by name: browsers reject an unbound `fetch`, and a
  // later polyfill or stub still counts.
  const fetch: typeof globalThis.fetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const { commands, history } = createCommands(baseUrl, fetch)
  const store = createStore<FamiliarState>()(() => ({
    connection: 'connecting',
    account: undefined,
    view: undefined,
    history: { entries: [], status: 'more' },
    transcript: undefined,
    memory: undefined,
    episodes: undefined,
    schedules: undefined,
  }))
  const { setState: set, getState: get } = store
  const conversation = createConversation(set, get, history)

  const events = openEvents(baseUrl, fetch, (connection) => set({ connection }))
  events.on('view', (view) =>
    set({ ...conversation.receive(view), connection: 'open' }),
  )
  events.on('ops', (ops) => set(conversation.apply(ops)))
  events.on('account', (account) => set({ account }))
  events.on('document', ({ name, value }) => set({ [name]: value }))
  events.on('document.ops', ({ name, ops }) =>
    set((state) => ({ [name]: applyImmutable(state[name] ?? undefined, ops) })),
  )

  return {
    getState: store.getState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe,
    ...commands,
    conversation: {
      ...commands.conversation,
      loadOlder: conversation.loadOlder,
    },
    disconnect: events.disconnect,
  }
}
