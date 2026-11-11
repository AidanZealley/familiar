import {
  createFamiliarStore,
  createRoomStore,
  createWorkspaceStore,
  type FamiliarState,
  type FamiliarStore,
  type WorkspaceState,
} from '@familiar-ai/client'
import { MutationCache, QueryClient } from '@tanstack/react-query'
import { createContext, use } from 'react'
import { useStore } from 'zustand'
import { pool } from './streams'

/**
 * The app's workspace connection, open for its lifetime: the login, push,
 * connections, and which Familiars and rooms there are. Call commands on it
 * directly, such as `workspace.account.signIn()`.
 */
export const workspace = createWorkspaceStore('/api')

/** Selects from the workspace's state, re-rendering when the selection changes. */
export const useWorkspace = <T>(selector: (state: WorkspaceState) => T): T =>
  useStore(workspace, selector)

/**
 * Each Familiar's stream (model, memory, schedules), open while something
 * on screen shows it: its DM, or its settings. See `useStream`.
 */
export const familiarStreams = pool((id) => createFamiliarStore('/api', id))

/** Each room's stream (log and turns), open while the room is. See `useStream`. */
export const roomStreams = pool((id) => createRoomStore('/api', id))

/**
 * The Familiar a subtree is about: the open DM's, or the one whose settings
 * are open. Rooms use the client's own `RoomProvider` in the same way.
 */
export const FamiliarContext = createContext<FamiliarStore | undefined>(
  undefined,
)

/** The nearest Familiar's store, for its commands. */
export const useFamiliarStore = () => {
  const store = use(FamiliarContext)
  if (!store) {
    throw new Error('Familiar hooks must be used within a FamiliarContext')
  }
  return store
}

/** Selects from the nearest Familiar's state. */
export const useFamiliar = <T>(selector: (state: FamiliarState) => T): T =>
  useStore(useFamiliarStore(), selector)

/**
 * Owns request state: what the app fetches instead of mirroring, such as
 * connections, and each command's progress and failure. A command that
 * succeeds refreshes the queries that share its key: one with
 * `mutationKey: ['connections']` refreshes `['connections']`.
 */
export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: (_data, _variables, _result, mutation, { client }) =>
      mutation.options.mutationKey &&
      client.invalidateQueries({ queryKey: mutation.options.mutationKey }),
  }),
})
