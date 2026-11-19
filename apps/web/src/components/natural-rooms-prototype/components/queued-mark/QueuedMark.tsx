import { ClockIcon } from '@phosphor-icons/react'
import { PixelAvatar } from '@/components/pixel-avatar'
import type { QueuedMarkProps } from './types'

/**
 * Queued variant B: under the person's message, beside its time, a small
 * mark for each Familiar that has it queued, until its run picks it up.
 */
export const QueuedMark = ({ waiting }: QueuedMarkProps) =>
  waiting.length > 0 && (
    <div className="-mt-4 flex justify-end">
      <span
        role="status"
        className="flex items-center gap-1.5 font-heading text-[0.7rem] text-muted-foreground"
      >
        <ClockIcon className="size-3" />
        Queued for
        {waiting.map((turn) => (
          <span key={turn.member.id} className="flex items-center gap-1">
            <PixelAvatar familiar={turn.member} crop="quarter" />
            {turn.member.name}
          </span>
        ))}
      </span>
    </div>
  )
