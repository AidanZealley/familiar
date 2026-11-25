import { WarningCircleIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { DraftImages } from '../draft-images'
import type { FailedSendItemProps } from './types'

/**
 * A send that failed, above the composer and apart from its draft: what it
 * said and carried, why it failed, and Retry, Edit and Discard.
 */
export const FailedSendItem = ({
  failed: { draft, error },
  onRetry,
  onEdit,
  onDiscard,
}: FailedSendItemProps) => {
  const kind = draft.note ? 'Note' : 'Message'
  return (
    <section
      aria-label={`${kind} not sent`}
      className="mb-2 border border-destructive/40 bg-background/80 text-xs backdrop-blur-xl"
    >
      <p
        role="alert"
        className="flex items-start gap-1.5 px-3 pt-2 text-destructive"
      >
        <WarningCircleIcon className="mt-px size-3.5 shrink-0" />
        <span>
          {kind} not sent: {error}
        </span>
      </p>
      {draft.text && (
        <p className="line-clamp-3 px-3 pt-1 whitespace-pre-wrap">
          {draft.text}
        </p>
      )}
      {draft.images.length > 0 && <DraftImages images={draft.images} />}
      <div className="flex justify-end gap-1 px-2 pt-1 pb-2">
        <Button size="xs" variant="ghost" onClick={onDiscard}>
          Discard
        </Button>
        {onEdit && (
          <Button size="xs" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
        )}
        <Button size="xs" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </section>
  )
}
