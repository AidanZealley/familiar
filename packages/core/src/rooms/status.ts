import type { EntryId, SubmissionId, Tx } from '@earendil-works/pi-durable'
import { LiveDoc } from '@earendil-works/pi-durable'
import type { InRoom } from '../conversation/message.ts'
import type { FamiliarId } from '../workspace/familiars.ts'
import type { RoomId } from './rooms.ts'

/**
 * Who is busy where, derived from Pi with no state of its own: a Familiar is
 * replying in a room while its chat's live run holds an input from that
 * room, and queued there while its inbox holds one. Each chat input from a
 * room says where it came from (`InRoom`); inputs with no room, such as
 * direct chat work, count for no room.
 */

/** Where a chat input came from: its room, and the room entry it answers. */
export type Origin = { room: RoomId; cause: EntryId }

/** The origin an input entry's data records, if it came from a room. */
export const originOf = (data: unknown): Origin | null => {
  const { room, entry } = (data ?? {}) as InRoom
  return room !== undefined && entry !== undefined
    ? { room: room as RoomId, cause: entry }
    : null
}

/** Where the placed input `id` came from, read in `tx`. */
export async function inputOrigin(tx: Tx, id: SubmissionId) {
  const submission = await tx.submission(id)
  const entry =
    submission?.type === 'input' && submission.entry !== undefined
      ? await tx.entry(submission.entry)
      : undefined
  return originOf(entry?.data)
}

/**
 * Where `familiar`'s live run's input came from, if it's a room's. A run
 * that has answered and is only posting its reply has no inputs left.
 */
export async function runOrigin(tx: Tx, familiar: FamiliarId) {
  const { run } = await tx.doc(LiveDoc, familiar)
  for (const id of run?.inputs ?? []) {
    const origin = await inputOrigin(tx, id)
    if (origin) {
      return origin
    }
  }
  return null
}

/** Which of `familiars` are replying in `room` now. */
export async function replyingIn(
  tx: Tx,
  room: RoomId,
  familiars: readonly FamiliarId[],
) {
  const replying: FamiliarId[] = []
  for (const familiar of familiars) {
    if (String((await runOrigin(tx, familiar))?.room) === String(room)) {
      replying.push(familiar)
    }
  }
  return replying
}
