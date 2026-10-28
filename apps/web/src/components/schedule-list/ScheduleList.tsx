import { schedulesByNext } from '@familiar/client'
import { useFamiliar } from '@/lib/familiar'
import { ScheduleItem } from './components/schedule-item'

/** Every schedule, soonest first. Familiar adds them when asked in chat. */
export const ScheduleList = () => {
  const schedules = useFamiliar((state) => state.schedules)
  if (schedules === undefined) {
    return null
  }
  const sorted = schedulesByNext(schedules)

  if (!sorted.length) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nothing scheduled. Ask Familiar in chat, like “remind me at 6 to call
        Mum” or “every weekday at 7, brief me on my day”.
      </p>
    )
  }

  return (
    <ul className="flex flex-col divide-y">
      {sorted.map((schedule) => (
        <ScheduleItem key={schedule.id} schedule={schedule} />
      ))}
    </ul>
  )
}
