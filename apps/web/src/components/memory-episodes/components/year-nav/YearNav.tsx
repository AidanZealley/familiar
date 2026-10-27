import { cn } from 'cn'
import { useEffect, useRef } from 'react'
import type { YearNavProps } from './types'

const short = new Intl.DateTimeFormat(undefined, { month: 'short' })
const label = (month: string) => short.format(new Date(`${month}-15T12:00:00`))

/**
 * Jumps between months. Where there's room, a side rail of years with the
 * one being read opened to its months. On a phone, a small capsule above
 * the docked nav, a step down from it: every month in one strip, under a
 * sticky year, keeping the current month in view.
 */
export const YearNav = ({
  months,
  active,
  onSelect,
  horizontal,
}: YearNavProps) => {
  const years = [...new Set(months.map((month) => month.slice(0, 4)))]
  const activeYear = active?.slice(0, 4)
  const nav = useRef<HTMLElement>(null)

  useEffect(() => {
    const element = nav.current
    const current = element?.querySelector<HTMLElement>('[aria-current]')
    if (!horizontal || !element || !current) return
    // Centred, but never short of its year's start, so that year's label
    // is the one held at the left rather than half pushed off by it.
    const year = current.parentElement!
    element.scrollTo({
      left: Math.max(
        year.offsetLeft,
        current.offsetLeft - (element.clientWidth - current.offsetWidth) / 2,
      ),
      behavior: 'smooth',
    })
  }, [active, horizontal])

  const firstOf = (year: string) =>
    months.find((month) => month.startsWith(year))!

  // Every month in one strip; each year's label sticks at the left while
  // its months scroll under it, until the next year's pushes it away.
  if (horizontal)
    return (
      <nav
        ref={nav}
        aria-label="Jump to month"
        className="pointer-events-auto relative flex max-w-xs [scrollbar-width:none] overflow-x-auto rounded-[calc(var(--radius-md)+0.125rem)] border bg-card/90 p-0.5 text-xs shadow-md shadow-black/8 backdrop-blur-md"
      >
        {years.map((year) => (
          <div key={year} className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => onSelect(firstOf(year))}
              className="sticky left-0 z-10 h-7 rounded-md bg-card px-2 font-semibold tabular-nums"
            >
              {year}
            </button>
            {months
              .filter((month) => month.startsWith(year))
              .map((month) => (
                <button
                  key={month}
                  type="button"
                  aria-current={month === active ? 'true' : undefined}
                  onClick={() => onSelect(month)}
                  className={cn(
                    'h-7 shrink-0 rounded-md px-2 text-muted-foreground',
                    month === active && 'bg-muted text-foreground',
                  )}
                >
                  {label(month)}
                </button>
              ))}
          </div>
        ))}
      </nav>
    )

  return (
    <nav
      aria-label="Jump to month"
      className="sticky top-[calc(var(--chrome)+4rem)] flex w-16 flex-col self-start text-xs"
    >
      {years.map((year) => {
        const open = year === activeYear
        return (
          <div key={year} className="flex flex-col">
            <button
              type="button"
              onClick={() => onSelect(firstOf(year))}
              className={cn(
                'py-1.5 text-left font-medium tabular-nums',
                open ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {year}
            </button>
            {open && (
              <ol className="mb-2 flex flex-col border-l">
                {months
                  .filter((month) => month.startsWith(year))
                  .map((month) => (
                    <li key={month}>
                      <button
                        type="button"
                        aria-current={month === active ? 'true' : undefined}
                        onClick={() => onSelect(month)}
                        className={cn(
                          '-ml-px w-full border-l-2 border-transparent py-1 pl-2 text-left text-muted-foreground hover:text-foreground',
                          month === active &&
                            'border-primary font-medium text-foreground',
                        )}
                      >
                        {label(month)}
                      </button>
                    </li>
                  ))}
              </ol>
            )}
          </div>
        )
      })}
    </nav>
  )
}
