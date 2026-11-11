import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  InboxDoc,
  LiveDoc,
  type Harness,
  type WatchHandle,
} from '@earendil-works/pi-durable'
import { derivedWatch } from '../pi/watch.ts'
import type { FamiliarId } from '../workspace/familiars.ts'
import {
  activityOf,
  chatsOf,
  turnsIn,
  type Chat,
  type TurnActivity,
} from './activity.ts'
import { Shown, type RoomPreview, type RoomShown } from './log.ts'
import {
  Rooms,
  seenBy,
  Turns,
  type Room,
  type RoomId,
  type RoomRegistry,
  type TurnRecord,
} from './rooms.ts'

/**
 * Rooms as a list shows them, for a sidebar: each room's setup, its newest
 * entry, what the person hasn't read and whose turns are in progress.
 * Derived from the registry, what each log has shown and how far the person
 * has read it, and the turns in progress, never stored, so the workspace's
 * one stream carries every room's state.
 */

/** A turn in progress in a room, as a list shows it: whose, and how it's going. */
export type RoomTurn = Pick<TurnActivity, 'familiar' | 'status'>

/** A room as a list shows it. */
export type RoomListing = Room & {
  /**
   * Its newest entry worth showing, to preview it and sort by; absent until
   * one is posted. A reply whose `outcome` is `failed` means its last turn
   * failed.
   */
  last?: RoomPreview
  /**
   * How many entries the person hasn't read since their marker (see
   * `RoomApi.read`); all of them if they've never read it. Only in a
   * person's list.
   */
  unread?: number
  /**
   * Its turns in progress, oldest first: each `queued` behind work in this
   * room, `elsewhere` while its Familiar works in another room, or
   * `running`. Empty when no one is working on it.
   */
  turns: RoomTurn[]
}

/** The rooms a list shows, by RoomId. */
export type RoomsState = {
  /** Object keys are strings, so a key is `String(id)`. */
  rooms: Record<string, RoomListing>
}

/** What a list is derived from, as far as each has been read. */
type Sources = {
  registry: Readonly<RoomRegistry> | null | undefined
  shown: Readonly<Record<string, RoomShown>> | null | undefined
  turns: Readonly<Record<string, TurnRecord>> | null | undefined
  chatOf: (familiar: FamiliarId) => Chat
}

/** The rooms `person` sees, as their list shows them; every room without one. */
function listingsOf(sources: Sources, person: string | undefined) {
  const rooms: Record<string, RoomListing> = {}
  for (const [id, room] of Object.entries(sources.registry?.rooms ?? {})) {
    if (!seenBy(room, person)) {
      continue
    }
    const shown = sources.shown?.[id]
    const read = person === undefined ? undefined : shown?.read[person]
    rooms[id] = {
      ...room,
      ...(shown && { last: shown.last }),
      ...(person !== undefined && {
        unread: (shown?.count ?? 0) - (read?.count ?? 0),
      }),
      turns: Object.values(
        activityOf(turnsIn(sources.turns, id), sources.chatOf),
      ).map(({ familiar, status }) => ({ familiar, status })),
    }
  }
  return { rooms } satisfies RoomsState
}

const context = BACKGROUND_CONTEXT

/** The rooms `person` sees, as their list shows them now. */
export async function listRooms(harness: Harness, person?: string) {
  const [registry, shown, turns] = await Promise.all([
    harness.snapshot(Rooms, context),
    harness.snapshot(Shown, context),
    harness.snapshot(Turns, context),
  ])
  const familiars = new Set(
    Object.values(turns ?? {}).map((turn) => turn.familiar),
  )
  const chats = new Map(
    await Promise.all(
      [...familiars].map(
        async (familiar) =>
          [
            familiar,
            {
              live: await harness.snapshot(LiveDoc, familiar, context),
              inbox: await harness.snapshot(InboxDoc, familiar, context),
            },
          ] as const,
      ),
    ),
  )
  const { rooms } = listingsOf(
    {
      registry,
      shown,
      turns,
      chatOf: (familiar) =>
        chats.get(familiar) ?? { live: undefined, inbox: undefined },
    },
    person,
  )
  return Object.entries(rooms).map(([id, room]) => ({
    id: Number(id) as RoomId,
    ...room,
  }))
}

/**
 * The rooms `person` sees, as their list shows them, live. Follows each
 * Familiar's chat from its first turn in any room until the watch stops.
 */
export async function watchRooms(
  harness: Harness,
  person?: string,
): Promise<WatchHandle<RoomsState>> {
  // Opening the workspace creates each of these.
  const [registry, shown, turns] = await Promise.all([
    harness.watchDoc(Rooms, context),
    harness.watchDoc(Shown, context),
    harness.watchDoc(Turns, context),
  ])
  const chats = chatsOf(harness)
  const derived = derivedWatch(() =>
    listingsOf(
      {
        registry: registry!.value,
        shown: shown!.value,
        turns: turns!.value,
        chatOf: chats.chatOf,
      },
      person,
    ),
  )
  derived.follow(registry!)
  derived.follow(shown!)
  derived.follow(turns!, () => chats.follow(derived, turns!.value))
  return derived.watch
}
