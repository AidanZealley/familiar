import type { AccountState } from '@familiar-ai/core/http'
import { createStore } from 'zustand/vanilla'
import { createApi, workspaceCommands } from './commands.ts'
import type { Connection } from './events.ts'
import {
  fetchOf,
  openMirror,
  type MirroredDocuments,
  type Store,
  type StoreOptions,
} from './mirror.ts'

/** What the workspace's stream has sent, as plain data. */
export type WorkspaceState = {
  connection: Connection
  /** Undefined until the first frame; null when the host manages credentials. */
  account: AccountState | null | undefined
} & MirroredDocuments<'familiars' | 'rooms'>

export type WorkspaceStore = Store<WorkspaceState> &
  ReturnType<typeof workspaceCommands>

/**
 * A live mirror of a workspace: who its Familiars are, the rooms the
 * signed-in person sees and the login, with what changes them.
 * Framework-free: subscribe anywhere, or use zustand's `useStore`.
 *
 * A command that fails rejects with the server's reason and is never sent
 * again. Only the stream retries, and only by reconnecting.
 *
 * @param baseUrl Where the HTTP API is mounted: `/api`, or a full URL.
 */
export function createWorkspaceStore(
  baseUrl: string,
  options: StoreOptions = {},
): WorkspaceStore {
  const fetch = fetchOf(options)
  const store = createStore<WorkspaceState>()(() => ({
    connection: 'connecting',
    account: undefined,
    familiars: undefined,
    rooms: undefined,
  }))
  const mirror = openMirror(`${baseUrl}/events`, fetch, store)
  mirror.on('account', (account) => store.setState({ account }))
  return {
    ...mirror.readable,
    ...workspaceCommands(createApi(baseUrl, fetch)),
  }
}
