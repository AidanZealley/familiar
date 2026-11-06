import { useMutation } from '@tanstack/react-query'
import { RepeatIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { familiar } from '@/lib/familiar'
import { formatRepeat, formatTime } from '@/lib/format'
import type { ScheduleItemProps } from './types'

/** One row of a day: the time, how often, and the instruction to expand. */
export const ScheduleItem = ({ schedule }: ScheduleItemProps) => {
  const [expanded, setExpanded] = useState(false)
  // The mirrored document drops a cancelled schedule, removing this item.
  const cancel = useMutation({
    mutationFn: () => familiar.schedules.cancel(schedule.id),
  })

  return (
    <li className="group col-span-3 grid grid-cols-subgrid gap-x-3 py-3">
      <time
        dateTime={new Date(schedule.next).toISOString()}
        className="pt-px font-mono text-lg leading-tight tabular-nums"
      >
        {formatTime(schedule.next)}
      </time>
      <div className="min-w-0">
        <p className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
          {schedule.repeat && <RepeatIcon className="size-3" />}
          {schedule.repeat ? formatRepeat(schedule.repeat) : 'Once'}
        </p>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className={cn(
            'block w-full text-left text-sm leading-relaxed',
            !expanded && 'line-clamp-2',
          )}
        >
          {schedule.prompt}
        </button>
        {cancel.error && (
          <p className="mt-1 text-xs text-destructive">
            {cancel.error.message}
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Cancel"
        title="Cancel"
        disabled={cancel.isPending}
        onClick={() => cancel.mutate()}
        className="text-muted-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
      >
        <XIcon />
      </Button>
    </li>
  )
}
