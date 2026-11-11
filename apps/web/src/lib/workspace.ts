import type {
  FamiliarsState,
  FamiliarSummary,
  RoomPreview,
  RoomsState,
  RoomSummary,
  RoomTurn,
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

/**
 * Newest activity first, by each item's latest entry; items with none keep
 * their order after them. Stable, so ties keep the order they came in.
 */
export const latestFirst = <T>(
  items: readonly T[],
  latest: (item: T) => RoomPreview | undefined,
) => items.toSorted((a, b) => (latest(b)?.at ?? 0) - (latest(a)?.at ?? 0))

/** A Familiar's DM, if the person has opened one. */
export const dmOf = (rooms: readonly RoomSummary[], familiar: number) =>
  rooms.find((room) => room.kind === 'dm' && room.familiar === familiar)

/**
 * Markdown as the words it shows, roughly: links as their text, without
 * emphasis, code ticks or headings, nor a leading quote or list marker. Enough for a
 * one-line preview; anything it misses shows as typed.
 */
export const plainText = (markdown: string) =>
  markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    // A preview is one line, so a heading may be anywhere; a list or quote
    // marker only counts at the start, where it can't be prose.
    .replace(/(^|\s)#{1,6}\s+/g, '$1')
    .replace(/^\s*(>|[-*+]|\d+\.)\s+/, '')
    .replace(/(\*\*|__|\*|_|~~|`+)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * A room's latest entry as a list previews it, on one line: `Ada: Sure…`,
 * `You: Thanks`, `Ada couldn't answer`. `me` is the person's author ID.
 */
export const previewOf = (
  latest: RoomPreview,
  familiars: readonly FamiliarSummary[],
  me: string | undefined,
) => {
  const last = { ...latest, text: plainText(latest.text) }
  switch (last.kind) {
    case 'message':
      return `${last.author.id === me ? 'You' : last.author.name}: ${last.text}`
    case 'reply': {
      const name = nameOf(familiars, last.familiar, last.name)
      if (last.outcome === 'failed') {
        return `${name} couldn't answer`
      }
      return last.text
        ? `${name}: ${last.text}`
        : `${name} ${last.outcome === 'stopped' ? 'was stopped' : 'answered'}`
    }
    case 'handoff':
      return `${nameOf(familiars, last.familiar, last.name)} handed off: ${last.text}`
    case 'reminder':
      return `Reminder: ${last.text}`
    case 'note':
      return `Note: ${last.text}`
  }
}

/** Who has a turn in a room: answering, queued behind it, or busy in another room. */
export type Live = Record<RoomTurn['status'], number[]>

/** A room's turns in progress, by how they're going, each Familiar once. */
export const liveOf = (turns: readonly RoomTurn[] = []): Live => {
  const live: Live = { running: [], queued: [], elsewhere: [] }
  for (const { familiar, status } of turns) {
    if (!live[status].includes(familiar)) {
      live[status].push(familiar)
    }
  }
  return live
}
