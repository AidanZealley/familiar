import type { Draft } from '@/lib/outbox'

export type FailedSendItemProps = {
  /** What was sent. */
  draft: Draft
  /** Why it failed. */
  error: string
  onRetry(): void
  /** Takes it into the composer; offered only while the draft is empty. */
  onEdit?: () => void
  onDiscard(): void
}
