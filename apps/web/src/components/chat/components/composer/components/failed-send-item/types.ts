import type { FailedSend } from '../../useSend'

export type FailedSendItemProps = {
  failed: FailedSend
  onRetry(): void
  /** Takes it into the composer; offered only while the draft is empty. */
  onEdit?: () => void
  onDiscard(): void
  onRemoveImage(id: number): void
}
