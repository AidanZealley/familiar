import { useEffect, useRef, useState } from 'react'
import { PageHeading } from '@/components/page-heading'
import { useFamiliar } from '@/lib/familiar'
import { episodeMonths } from '@/lib/memory'
import { EpisodeMonth } from './components/episode-month'
import { YearNav } from './components/year-nav'

/**
 * Episodes as a stream, newest month first, with a year and month picker
 * that follows the page's scroll. Beside the stream when there's room;
 * docked above the Memory nav on a phone, at `--dock`.
 */
export const MemoryEpisodes = () => {
  const episodes = useFamiliar((state) => state.episodes?.episodes)
  const months = episodes ? episodeMonths(episodes) : []
  const keys = months.map((month) => month.key)
  const [active, setActive] = useState<string>()
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const update = () => {
      const sections =
        list.current?.querySelectorAll<HTMLElement>('[data-month]')
      // A month is current once it reaches its sticky heading, wherever the
      // chrome above puts that.
      const heading = sections?.[0]?.querySelector('h2')
      const line = heading
        ? parseFloat(getComputedStyle(heading).top) + heading.offsetHeight + 8
        : 0
      let current = sections?.[0]?.dataset.month
      for (const section of sections ?? []) {
        if (section.getBoundingClientRect().top <= line) {
          current = section.dataset.month
        }
      }
      setActive(current)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [episodes])

  const select = (key: string) =>
    document
      .getElementById(`episodes-${key}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <>
      <PageHeading
        title="Episodes"
        description="What happened, as Familiar summarised it each night, then each week and month."
      />
      {episodes && months.length === 0 && (
        <p className="mt-6 text-sm text-muted-foreground">
          Familiar writes the first episode tonight, after today’s conversation.
        </p>
      )}
      {months.length > 0 && (
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_auto] md:gap-6">
          <div ref={list}>
            {months.map((month) => (
              <EpisodeMonth key={month.key} month={month} />
            ))}
          </div>
          <div className="hidden md:block">
            <YearNav months={keys} active={active} onSelect={select} />
          </div>
          {/* On a phone it docks just above the nav capsule, inside the nav's
              fade rather than over a fade of its own. */}
          <div className="pointer-events-none sticky bottom-(--dock) z-30 flex justify-center md:hidden">
            <YearNav
              months={keys}
              active={active}
              onSelect={select}
              horizontal
            />
          </div>
        </div>
      )}
    </>
  )
}
