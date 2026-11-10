import { createStore } from 'zustand/vanilla'
import { createApi, familiarCommands } from './commands.ts'
import type { Connection } from './events.ts'
import {
  fetchOf,
  openMirror,
  type MirroredDocuments,
  type Store,
  type StoreOptions,
} from './mirror.ts'

/** What a Familiar's stream has sent, as plain data. */
export type FamiliarState = { connection: Connection } & MirroredDocuments<
  'model' | 'memory' | 'episodes' | 'schedules'
>

export type FamiliarStore = Store<FamiliarState> &
  ReturnType<typeof familiarCommands>

/**
 * A live mirror of one Familiar: the model it's on, its memory and its
 * schedules, with what changes them. People talk to it in rooms
 * (`createRoomStore`). Commands behave as the workspace store's.
 *
 * @param baseUrl Where the HTTP API is mounted: `/api`, or a full URL.
 * @param familiar The Familiar's ID.
 */
export function createFamiliarStore(
  baseUrl: string,
  familiar: number,
  options: StoreOptions = {},
): FamiliarStore {
  const fetch = fetchOf(options)
  const store = createStore<FamiliarState>()(() => ({
    connection: 'connecting',
    model: undefined,
    memory: undefined,
    episodes: undefined,
    schedules: undefined,
  }))
  const mirror = openMirror(
    `${baseUrl}/familiars/${familiar}/events`,
    fetch,
    store,
  )
  return {
    ...mirror.readable,
    ...familiarCommands(createApi(baseUrl, fetch), familiar),
  }
}
