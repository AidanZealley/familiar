import { useQuery } from '@tanstack/react-query'
import { useFamiliarStore } from '@/lib/familiar'
import { formatDate, localDate } from '@/lib/format'
import { SaidIn } from '../../../said-in'
import type { JournalMonthProps } from './types'

const monthFormat = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
})

/** One month's lines, by the day each happened, newest first. */
export const JournalMonth = ({ familiar, month }: JournalMonthProps) => {
  const store = useFamiliarStore()
  const lines = useQuery({
    queryKey: ['memory', familiar.id, 'journal', month],
    queryFn: () => store.memory.journal(month),
  })

  return (
    <section className="flex flex-col gap-2">
      <h4 className="border-b pb-1 text-xs font-medium text-muted-foreground">
        {monthFormat.format(localDate(`${month}-01`))}
      </h4>
      <ul className="flex flex-col gap-2">
        {lines.data
          ?.toSorted((a, b) => b.on.localeCompare(a.on))
          .map((line, index) => (
            <li key={index} className="flex gap-3">
              <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatDate(line.on)}
              </span>
              <span className="flex min-w-0 flex-col">
                <span>{line.text}</span>
                <span className="text-xs text-muted-foreground">
                  <SaidIn saidBy={line.saidBy} room={line.room} /> · “
                  {line.quote}”
                </span>
              </span>
            </li>
          ))}
      </ul>
    </section>
  )
}
