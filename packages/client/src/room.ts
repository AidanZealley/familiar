import type { RoomActivity } from '@familiar-ai/core/http'
import { createStore } from 'zustand/vanilla'
import { createApi, roomCommands } from './commands.ts'
import type { Connection } from './events.ts'
import { createLog, type LogState } from './log.ts'
import { fetchOf, openMirror, type Store, type StoreOptions } from './mirror.ts'

/** What a room's stream has sent, as plain data, with its transcript. */
export type RoomState = LogState & { connection: Connection }

export type RoomStore = Store<RoomState> &
  Omit<ReturnType<typeof roomCommands>, 'history'> & {
    /**
     * Loads the next older page into `history`. Its `status` shows
     * progress and failure, so this never rejects.
     */
    loadOlder(): Promise<void>
  }

/**
 * A live mirror of one room: its log, its turns in progress and the
 * transcript a chat UI draws from them, with posting and Stop. Commands
 * behave as the workspace store's.
 *
 * @param baseUrl Where the HTTP API is mounted: `/api`, or a full URL.
 * @param room The room's ID, such as from `familiars.dm` or `rooms.list`.
 */
export function createRoomStore(
  baseUrl: string,
  room: number,
  options: StoreOptions = {},
): RoomStore {
  const fetch = fetchOf(options)
  const { history, ...commands } = roomCommands(createApi(baseUrl, fetch), room)
  const store = createStore<RoomState>()(() => ({
    connection: 'connecting',
    view: undefined,
    history: { entries: [], status: 'more' },
    turns: undefined,
    transcript: undefined,
  }))
  const { setState: set, getState: get } = store
  // The log owns the view, history, turns and the transcript derived from them.
  const log = createLog(set, get, history)
  const mirror = openMirror(
    `${baseUrl}/rooms/${room}/events`,
    fetch,
    store,
    (name, value) =>
      name === 'turns'
        ? log.turns(value as RoomActivity | null)
        : { [name]: value },
  )
  mirror.on('view', (view) => set(log.receive(view)))
  mirror.on('ops', (ops) => set(log.apply(ops)))

  return {
    ...mirror.readable,
    ...commands,
    loadOlder: log.loadOlder,
  }
}
