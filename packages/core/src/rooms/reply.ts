import type { ConversationView, EntryId } from '@earendil-works/pi-durable'
import type { RoomApi } from './index.ts'
import { REPLY_KIND, type ReplyData } from './log.ts'

/**
 * The reply in `room` that answers `entry`, once there is one, for tools
 * that go one message at a time: the demo's seeding, the evals and tests.
 * Never settles for a turn stopped before it said anything.
 */
export async function replyTo(room: RoomApi, entry: EntryId) {
  // The window starts at `entry`, so its reply is in view however long the room.
  const watch = await room.watch({ from: entry })
  const find = (view: ConversationView) =>
    view.entries.find(
      (candidate) =>
        candidate.kind === REPLY_KIND &&
        (candidate.data as unknown as ReplyData).cause === entry,
    )?.data as unknown as ReplyData | undefined
  try {
    return (
      find(watch.value) ??
      (await new Promise<ReplyData>((resolve, reject) => {
        void watch.closed.then(() =>
          reject(new Error('The room closed before a reply came.')),
        )
        watch.start(async (call) => {
          const reply = call.kind === 'value' && find(call.value)
          if (reply) {
            resolve(reply)
          }
        })
      }))
    )
  } finally {
    await watch.stop()
  }
}
