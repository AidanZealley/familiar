import {
  createFamiliarStore,
  createRoomStore,
  createWorkspaceStore,
  type FamiliarState,
  type FamiliarStore,
  type RoomState,
  type RoomStore,
  type WorkspaceState,
} from '@familiar-ai/client'
import { MutationCache, QueryClient } from '@tanstack/react-query'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

/**
 * The app's workspace connection, open for its lifetime: the login,
 * connections and push, and which Familiars and rooms there are. Call
 * commands on it directly, such as `workspace.account.signIn()`.
 */
export const workspace = createWorkspaceStore('/api')

/**
 * Where the app is: finding the first Familiar and the signed-in person's
 * DM with it, then their stores, open for the app's lifetime. The app has
 * one chat, that DM, and its memory, schedules and model pages are that
 * Familiar's.
 */
export type Home =
  | { status: 'finding' }
  | { status: 'ready'; id: number; familiar: FamiliarStore; room: RoomStore }
  | { status: 'failed'; error: string }

export const home = createStore<Home>()(() => ({ status: 'finding' }))

const find = async (familiars: NonNullable<WorkspaceState['familiars']>) => {
  const [first] = Object.keys(familiars.familiars)
    .map(Number)
    .sort((a, b) => a - b)
  if (first === undefined) {
    throw new Error('This workspace has no Familiar yet.')
  }
  const room = await workspace.familiars.dm(first)
  home.setState({
    status: 'ready',
    id: first,
    familiar: createFamiliarStore('/api', first),
    room: createRoomStore('/api', room),
  })
}

// Found once, from the first list of Familiars the stream sends.
const stop = workspace.subscribe(({ familiars }) => {
  if (familiars) {
    stop()
    find(familiars).catch((error: unknown) =>
      home.setState({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  }
})

const ready = () => {
  const state = home.getState()
  if (state.status !== 'ready') {
    throw new Error('The app has no Familiar yet.')
  }
  return state
}

/** The app's Familiar, for its commands, once `home` is ready. */
export const familiar = () => ready().familiar

/** The app's Familiar's ID, once `home` is ready. */
export const familiarId = () => ready().id

/** The app's chat, the signed-in person's DM, once `home` is ready. */
export const room = () => ready().room

/** Selects from the workspace's state, re-rendering when the selection changes. */
export const useWorkspace = <T>(selector: (state: WorkspaceState) => T): T =>
  useStore(workspace, selector)

/** Selects from the Familiar's state; only once `home` is ready. */
export const useFamiliar = <T>(selector: (state: FamiliarState) => T): T =>
  useStore(familiar(), selector)

/** Selects from the chat's state; only once `home` is ready. */
export const useRoom = <T>(selector: (state: RoomState) => T): T =>
  useStore(room(), selector)

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
