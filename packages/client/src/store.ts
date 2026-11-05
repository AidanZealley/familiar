import { applyImmutable } from '@earendil-works/chord/delta'
import type {
  AccountState,
  DocumentName,
  Documents,
} from '@familiar-ai/core/http'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { createCommands, type Commands } from './commands.ts'
import { createConversation, type ConversationState } from './conversation.ts'
import { openEvents, type Connection } from './events.ts'

export type FamiliarStoreOptions = {
  /**
   * Makes every request: each API call, the event stream, and each of the
   * stream's reconnects, so a host can attach a fresh credential each time.
   * It gets the URL and an init with the method, body, headers and abort
   * signal to pass on. Defaults to the platform's `fetch`.
   */
  fetch?: typeof fetch
}

/** What the event stream has sent, as plain data. */
export type FamiliarState = ConversationState & {
  connection: Connection
  /** Undefined until the first frame; null when the host manages credentials. */
  account: AccountState | null | undefined
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
