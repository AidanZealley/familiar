import type { Send } from '@/lib/outbox'

export type PendingMessageProps = {
  send: Send
}
