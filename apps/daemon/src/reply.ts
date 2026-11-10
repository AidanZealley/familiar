import type { ConversationView } from '@earendil-works/pi-durable'
import { REPLY_KIND, type ReplyData, type RoomApi } from '@familiar-ai/core'

/**
 * Waits until `room`'s log has the reply to `entry`, as a client watching
 * the room would see it. For the demo's seeding, the memory
 * eval and tests, which go one message at a time. Never settles for a turn
 * stopped before it said anything.
 */
export async function replyTo(room: RoomApi, entry: number) {
  const watch = await room.watch()
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
        watch.start(async (view) => {
          const reply = find(view)
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
