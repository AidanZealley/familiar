import type {
  FamiliarsState,
  FamiliarSummary,
  RoomsState,
  RoomSummary,
} from '@familiar-ai/client'
import { useMemo } from 'react'
import { useWorkspace } from './familiar'

/**
 * Views of the workspace's documents, for the sidebar, headers and
 * settings. Read-only: every change goes through `workspace`'s commands.
 */

export type NamedRoom = Extract<RoomSummary, { kind: 'room' }>

/**
 * A Familiar's or a room's ID, which core brands. The app gets them as plain
 * numbers from the URL and from documents' keys; this marks them as IDs.
 */
export type Id = FamiliarSummary['id']
export const asId = (id: number | string) => Number(id) as Id

/** Each entry with its ID, in ID order: the order they were made in. */
const byId = <T>(record: Readonly<Record<string, T>> | undefined) =>
  Object.entries(record ?? {})
    .map(([id, value]) => ({ ...value, id: asId(id) }))
    .sort((a, b) => a.id - b.id)

export const familiarsOf = (
  doc: Readonly<FamiliarsState> | null | undefined,
): FamiliarSummary[] => byId(doc?.familiars)

export const roomsOf = (
  doc: Readonly<RoomsState> | null | undefined,
): RoomSummary[] => byId(doc?.rooms)

/** Every Familiar, in the order they were made. */
export const useFamiliars = () => {
  const doc = useWorkspace((state) => state.familiars)
  return useMemo(() => familiarsOf(doc), [doc])
}

/** Every room the person sees, named and DMs, in the order they were made. */
export const useRooms = () => {
  const doc = useWorkspace((state) => state.rooms)
  return useMemo(() => roomsOf(doc), [doc])
}

/** A Familiar, by ID, as it is now; undefined once removed. */
export const useFamiliarSummary = (id: number) => {
  const identity = useWorkspace((state) => state.familiars?.familiars[id])
  return useMemo(
    (): FamiliarSummary | undefined =>
      identity && { ...identity, id: asId(id) },
    [identity, id],
  )
}

/** A room, by ID, as it is now. */
export const useRoomSummary = (id: number) => {
  const room = useWorkspace((state) => state.rooms?.rooms[id])
  return useMemo(
    (): RoomSummary | undefined => room && { ...room, id: asId(id) },
    [room, id],
  )
}

/** A Familiar's name now, else the one it had, for one since removed. */
export const nameOf = (
  familiars: readonly FamiliarSummary[],
  id: number,
  then?: string,
) =>
  familiars.find((familiar) => familiar.id === id)?.name ??
  then ??
  'Removed Familiar'

/** What a room is called: a DM by its Familiar. */
export const titleOf = (
  room: RoomSummary,
  familiars: readonly FamiliarSummary[],
) => (room.kind === 'dm' ? nameOf(familiars, room.familiar) : room.name)

/** A named room's members and lead in words: `3 Familiars · Atlas leads`. */
export const setupOf = (
  room: NamedRoom,
  familiars: readonly FamiliarSummary[],
) =>
  `${room.familiars.length} ${room.familiars.length === 1 ? 'Familiar' : 'Familiars'} · ${
    room.lead === undefined ? 'open' : `${nameOf(familiars, room.lead)} leads`
  }`
