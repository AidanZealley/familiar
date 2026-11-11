import { useMutation } from '@tanstack/react-query'
import { PauseIcon, PlayIcon, RepeatIcon, XIcon } from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useFamiliarStore, useWorkspace } from '@/lib/familiar'
import { formatRepeat, formatTime } from '@/lib/format'
import type { ScheduleItemProps } from './types'

/**
 * One row of a day: the time, how often and where, and the instruction to
 * expand; then pausing or resuming it, and cancelling it. A paused one
 * still shows when it would next run.
 */
export const ScheduleItem = ({ schedule }: ScheduleItemProps) => {
  const familiar = useFamiliarStore()
  const [expanded, setExpanded] = useState(false)
  // Where it runs when due: the room it was made in, if the person sees it.
  const room = useWorkspace(
    (state) => schedule.room !== undefined && state.rooms?.rooms[schedule.room],
  )
  // The mirrored document drops a cancelled schedule, removing this item and
  // its open dialog with it.
  const cancel = useMutation({
    mutationFn: () => familiar.schedules.cancel(schedule.id),
  })
  const pause = useMutation({
    mutationFn: () =>
      schedule.paused
        ? familiar.schedules.resume(schedule.id)
        : familiar.schedules.pause(schedule.id),
  })
  const cadence = schedule.repeat ? formatRepeat(schedule.repeat) : 'Once'
  const reveal =
    'text-muted-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100'

  return (
    <li className="group col-span-3 grid grid-cols-subgrid gap-x-3 py-3">
      <time
        dateTime={new Date(schedule.next).toISOString()}
        className={cn(
          'pt-px font-mono text-lg leading-tight tabular-nums',
          schedule.paused && 'text-muted-foreground',
        )}
      >
        {formatTime(schedule.next)}
      </time>
      <div className="min-w-0">
        <p className="mb-1 inline-flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {schedule.paused && <Badge variant="outline">Paused</Badge>}
          {schedule.repeat && <RepeatIcon className="size-3" />}
          {cadence}
          {room &&
            (room.kind === 'dm' ? ' · in your DM' : ` · in ${room.name}`)}
        </p>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="block w-full text-left text-sm leading-relaxed"
        >
          {/* Clamped inside: the button's own `block` would override it. */}
          <span
            className={cn(
              !expanded && 'line-clamp-2',
              schedule.paused && 'text-muted-foreground',
            )}
          >
            {schedule.prompt}
          </span>
        </button>
        {pause.error && (
          <p className="mt-1 text-xs wrap-anywhere text-destructive">
            {pause.error.message}
          </p>
        )}
      </div>
      <div className="flex items-start">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={schedule.paused ? 'Resume' : 'Pause'}
          title={schedule.paused ? 'Resume' : 'Pause'}
          disabled={pause.isPending}
          onClick={() => pause.mutate()}
          className={cn(reveal, schedule.paused && 'md:opacity-100')}
        >
          {schedule.paused ? <PlayIcon /> : <PauseIcon />}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Cancel"
                title="Cancel"
                className={cn(reveal, 'md:aria-expanded:opacity-100')}
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
              <p className="text-sm wrap-anywhere text-destructive">
                {cancel.error.message}
              </p>
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
      </div>
    </li>
  )
}
