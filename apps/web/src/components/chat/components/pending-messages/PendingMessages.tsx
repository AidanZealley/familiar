import { useRoom, useRoomStore } from '@familiar-ai/client/react'
import { useStore } from 'zustand'
import {
  discard,
  isShown,
  newestOf,
  outbox,
  retry,
  take,
  type Send,
} from '@/lib/outbox'
import { FailedSendItem } from './components/failed-send-item'
import { PendingMessage } from './components/pending-message'
import type { PendingMessagesProps } from './types'

const none: readonly Send[] = []

/**
 * The transcript's foot: the room's sends the transcript doesn't show yet,
 * oldest first. Each is pending until the room's stream delivers its
 * entry, when the entry takes its place, or becomes its failed item in
 * place, with Retry, Edit and Discard.
 */
export const PendingMessages = ({ room, onEdit }: PendingMessagesProps) => {
  const store = useRoomStore()
  const sends = useStore(outbox, (state) => state.sends.get(room) ?? none)
  const newest = useRoom(newestOf)

  return sends
    .filter((send) => !isShown(send, newest))
    .map((send) =>
      send.phase.status === 'failed' ? (
        <FailedSendItem
          key={send.key}
          draft={send.draft}
          error={send.phase.error}
          onRetry={() => retry(room, send.key, store)}
          onEdit={
            onEdit &&
            (() => {
              const draft = take(room, send.key)
              if (draft) {
                onEdit(draft)
              }
            })
          }
          onDiscard={() => discard(room, send.key)}
        />
      ) : (
        <PendingMessage key={send.key} send={send} />
      ),
    )
}
