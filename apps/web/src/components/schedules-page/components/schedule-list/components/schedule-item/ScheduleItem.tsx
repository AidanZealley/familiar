import { useMutation } from '@tanstack/react-query'
import { AlarmClockIcon, RepeatIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { familiar } from '@/lib/familiar'
import { formatNext } from '@/lib/format'
import type { ScheduleItemProps } from './types'

export const ScheduleItem = ({ schedule }: ScheduleItemProps) => {
  // The mirrored document drops a cancelled schedule, removing this item.
  const cancel = useMutation({
    mutationFn: () => familiar.schedules.cancel(schedule.id),
  })

  return (
    <li className="flex items-start gap-2 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[0.95rem] leading-snug">{schedule.prompt}</p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 text-foreground">
            <AlarmClockIcon className="size-3" />
            {formatNext(schedule.next)}
          </span>
          {schedule.repeat && (
            <span className="inline-flex items-center gap-1">
              <RepeatIcon className="size-3" />
              Repeats
            </span>
          )}
        </p>
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
        className="text-muted-foreground"
      >
        <XIcon />
      </Button>
    </li>
  )
}
