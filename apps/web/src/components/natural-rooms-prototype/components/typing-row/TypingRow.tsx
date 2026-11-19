import { cn } from 'cn'
import { HourglassSpinner } from '@/components/hourglass-spinner'
import { PixelAvatar } from '@/components/pixel-avatar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { Turn } from '../../timeline'
import type { TypingRowProps } from './types'

const names = (turns: Turn[]) => {
  const all = turns.map((turn) => turn.member.name)
  return all.length > 1
    ? `${all.slice(0, -1).join(', ')} and ${all.at(-1)}`
    : (all[0] ?? '')
}

const why = (turn: Turn) =>
  turn.status === 'elsewhere'
    ? `${turn.member.name} is replying in ${turn.room}. It'll pick this up after.`
    : `${turn.member.name} is finishing another reply here, then gets to this.`

/**
 * Variant A: one row under the transcript. Who's replying, as overlapping
 * portraits that talk, beside the hourglass. Queued Familiars join it
 * dimmed; hovering one says where it's busy.
 */
export const TypingRow = ({ running, waiting }: TypingRowProps) => {
  if (!running.length && !waiting.length) {
    return null
  }
  const label = running.length
    ? `${names(running)} ${running.length > 1 ? 'are' : 'is'} replying…`
    : `${names(waiting)} will reply after another room`

  return (
    <div role="status" className="flex items-center gap-3">
      <span className="flex">
        {running.map((turn, index) => (
          <PixelAvatar
            key={turn.member.id}
            familiar={turn.member}
            talking
            className={cn('ring-2 ring-background', index > 0 && '-ml-2')}
          />
        ))}
        {waiting.map((turn, index) => (
          <Popover key={turn.member.id}>
            <PopoverTrigger
              openOnHover
              delay={100}
              aria-label={why(turn)}
              className={cn(
                'cursor-default',
                (running.length > 0 || index > 0) && '-ml-2',
              )}
            >
              <PixelAvatar
                familiar={turn.member}
                className="opacity-40 ring-2 ring-background grayscale"
              />
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-auto">
              {why(turn)}
            </PopoverContent>
          </Popover>
        ))}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <HourglassSpinner />
        <span className="truncate">{label}</span>
      </span>
    </div>
  )
}
