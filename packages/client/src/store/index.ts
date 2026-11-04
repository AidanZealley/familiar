import { createStore } from 'zustand/vanilla'
import { createCommands } from '../commands.ts'
import { createConversation } from '../conversation.ts'
import { openEvents } from '../events.ts'
import type { SupportedHostApi } from './host-api.ts'
import type {
  FamiliarState,
  FamiliarStore,
  FamiliarStoreOptions,
} from './types.ts'
import { receiveDocument, applyDocumentOps } from './documents.ts'

/**
 * A live mirror of one Familiar's conversation. Framework-free: use it with
 * `useStore` from zustand in React, or `subscribe` anywhere else.
 *
 * A command that fails rejects with the server's reason and is never sent
 * again. Only the stream retries, and only by reconnecting.
 *
 * @typeParam Api The host's API type, such as `typeof api` imported with
 *   `import type`, which decides the commands the store offers. Required.
 * @param baseUrl Where the HTTP API is mounted: `/api`, or a full URL.
 */
export function createFamiliarStore<Api>(
  baseUrl: string & ([SupportedHostApi<Api>] extends [never] ? never : unknown),
  options?: FamiliarStoreOptions,
): FamiliarStore<Api>
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
    events.on('document', (document) =>
      set((state) => receiveDocument(state, document)),
    )
    events.on('document.ops', (document) =>
      set((state) => applyDocumentOps(state, document)),
    )
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
