import type { RoomSummary } from '@familiar-ai/client'
import { useRoomStore } from '@familiar-ai/client/react'
import { useEffect } from 'react'
import { useIsVisible } from '@/lib/media'

/**
 * Marks the open room read up to its latest entry whenever it has unread
 * entries while the page is on screen, as each new one arrives too. Both come
 * from the workspace's listing, so a read moving the marker ends it.
 */
export const useReadWhileOpen = (room: RoomSummary) => {
  const store = useRoomStore()
  const visible = useIsVisible()
  const latest = room.last?.entry
  const unread = (room.unread ?? 0) > 0

  useEffect(() => {
    if (visible && unread && latest !== undefined) {
      // A failure leaves it unread, and the next entry or visit tries again.
      store.read(latest).catch(() => {})
    }
  }, [store, visible, unread, latest])
}
