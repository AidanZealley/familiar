import type { Draft } from '@/lib/outbox'

export type PendingMessagesProps = {
  /** The open room's ID. */
  room: number
  /** Takes a failed send back into the draft; only while the draft is empty. */
  onEdit?: (draft: Draft) => void
}
