import type { Schedule } from '@familiar-ai/client'
import { useFamiliar } from '@/lib/familiar'
import { formatRelativeDay } from '@/lib/format'
import { ScheduleItem } from './components/schedule-item'

/**
 * Every schedule, soonest first, grouped by the day it next runs. Familiar
 * adds them when asked in chat.
 */
export const ScheduleList = () => {
  const schedules = useFamiliar((state) => state.schedules)
  if (schedules === undefined) {
    return null
  }
  // Null when the host keeps no schedules: nothing to list.
  const sorted = Object.values(schedules ?? {}).toSorted(
    (a, b) => a.next - b.next,
  )

  if (!sorted.length) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nothing scheduled. Ask Familiar in chat, like “remind me at 6 to call
        Mum” or “every weekday at 7, brief me on my day”.
      </p>
    )
  }

  const days = new Map<string, Schedule[]>()
  for (const schedule of sorted) {
    const day = formatRelativeDay(schedule.next)
    days.set(day, [...(days.get(day) ?? []), schedule])
  }

  return (
    <div className="flex flex-col gap-6">
      {[...days].map(([day, items]) => (
        <section key={day}>
          <h2 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {day}
          </h2>
          {/* Rows share its columns, so times of any width line up. */}
          <ul className="grid grid-cols-[auto_1fr_auto] divide-y border-y">
            {items.map((schedule) => (
              <ScheduleItem key={schedule.id} schedule={schedule} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
