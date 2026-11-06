import { useMutation } from '@tanstack/react-query'
import { RepeatIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { cn } from 'cn'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { familiar } from '@/lib/familiar'
import { formatRepeat, formatTime } from '@/lib/format'
import type { ScheduleItemProps } from './types'

/** One row of a day: the time, how often, and the instruction to expand. */
export const ScheduleItem = ({ schedule }: ScheduleItemProps) => {
  const [expanded, setExpanded] = useState(false)
  // The mirrored document drops a cancelled schedule, removing this item and
  // its open dialog with it.
  const cancel = useMutation({
    mutationFn: () => familiar.schedules.cancel(schedule.id),
  })
  const cadence = schedule.repeat ? formatRepeat(schedule.repeat) : 'Once'

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
          {cadence}
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
      </div>
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Cancel"
              title="Cancel"
              className="text-muted-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:aria-expanded:opacity-100"
            />
          }
        >
          <XIcon />
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              Familiar won't run it again. To get it back, ask in chat.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {cancel.error && (
            <p className="text-sm text-destructive">{cancel.error.message}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              Cancel schedule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}
