import { AlarmClockIcon, RepeatIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { familiar } from '@/lib/familiar'
import type { ScheduleItemProps } from './types'

const nextFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export const ScheduleItem = ({ schedule }: ScheduleItemProps) => {
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string>()

  const cancel = async () => {
    setCancelling(true)
    setError(undefined)
    try {
      // The mirrored document drops it, which removes this item.
      await familiar.getState().cancelSchedule(schedule.id)
    } catch (failure) {
      setError((failure as Error).message)
      setCancelling(false)
    }
  }

  return (
    <li className="flex items-start gap-2 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[0.95rem] leading-snug">{schedule.prompt}</p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 text-foreground">
            <AlarmClockIcon className="size-3" />
            {nextFormat.format(schedule.next)}
          </span>
          {schedule.repeat && (
            <span className="inline-flex items-center gap-1">
              <RepeatIcon className="size-3" />
              Repeats
            </span>
          )}
        </p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Cancel"
        title="Cancel"
        disabled={cancelling}
        onClick={cancel}
        className="text-muted-foreground"
      >
        <XIcon />
      </Button>
    </li>
  )
}
