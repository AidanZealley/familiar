import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  InboxDoc,
  LiveDoc,
  type Harness,
  type SubmissionId,
  type WatchHandle,
} from '@earendil-works/pi-durable'
import { derivedWatch } from '../pi/watch.ts'
import type { FamiliarId } from '../workspace/familiars.ts'
import {
  activityOf,
  chatsOf,
  type Chat,
  type TurnActivity,
} from './activity.ts'
import { Shown, type RoomPreview, type RoomShown } from './log.ts'
import {
  membersOf,
  Rooms,
  seenBy,
  type Room,
  type RoomId,
  type RoomRegistry,
} from './rooms.ts'
import { inputOrigin, originOf, type Origin } from './status.ts'

/**
 * Rooms as a list shows them, for a sidebar: each room's setup, its newest
 * entry, what the person hasn't read and whose turns are in progress.
 * Derived from the registry, what each log has shown and how far the person
 * has read it, and its Familiars' chats, never stored, so the workspace's
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
   * Its Familiars working on it, in room order: each `running` while
   * replying here, `queued` behind work in this room, or `elsewhere` while
   * its Familiar works in another room. Empty when no one is.
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
      turns: Object.values(activityOf(id, membersOf(room), sources.chatOf)).map(
        ({ familiar, status }) => ({ familiar, status }),
      ),
    }
  }
  return { rooms } satisfies RoomsState
}

const context = BACKGROUND_CONTEXT

/** Every Familiar in a room. */
const inRooms = (registry: Readonly<RoomRegistry> | null | undefined) =>
  new Set(Object.values(registry?.rooms ?? {}).flatMap(membersOf))

/** The rooms `person` sees, as their list shows them now. */
export async function listRooms(harness: Harness, person?: string) {
  const [registry, shown] = await Promise.all([
    harness.snapshot(Rooms, context),
    harness.snapshot(Shown, context),
  ])
  const chats = new Map<FamiliarId, Chat>()
  for (const familiar of inRooms(registry)) {
    const live = await harness.snapshot(LiveDoc, familiar, context)
    const inbox = await harness.snapshot(InboxDoc, familiar, context)
    const origins = new Map<SubmissionId, Origin | null>(
      inbox?.items.map((item) => [item.id, originOf(item.entry?.data)]),
    )
    for (const input of live?.run?.inputs ?? []) {
      origins.set(
        input,
        await harness.commit((tx) => inputOrigin(tx, input), context),
      )
    }
    chats.set(familiar, {
      live,
      inbox,
      origin: (input) => origins.get(input),
    })
  }
  const { rooms } = listingsOf(
    {
      registry,
      shown,
      chatOf: (familiar) =>
        chats.get(familiar) ?? {
          live: undefined,
          inbox: undefined,
          origin: () => undefined,
        },
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
 * Familiar's chat from when it's first in a room until the watch stops.
 */
export async function watchRooms(
  harness: Harness,
  person?: string,
): Promise<WatchHandle<RoomsState>> {
  // Opening the workspace creates each of these.
  const [registry, shown] = await Promise.all([
    harness.watchDoc(Rooms, context),
    harness.watchDoc(Shown, context),
  ])
  const familiars = () => inRooms(registry!.value)
  const chats = chatsOf(harness)
  await chats.follow(familiars())
  const derived = derivedWatch(() =>
    listingsOf(
      {
        registry: registry!.value,
        shown: shown!.value,
        chatOf: chats.chatOf,
      },
      person,
    ),
  )
  chats.start(derived)
  derived.follow(registry!, () => void chats.follow(familiars()))
  derived.follow(shown!)
  return derived.watch
}
