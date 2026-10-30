import { PageHeading } from '@/components/page-heading'
import { useFamiliar } from '@/lib/familiar'
import { episodeMonths } from '@/lib/memory'
import { EpisodeMonth } from './components/episode-month'

export const MemoryEpisodes = () => {
  const episodes = useFamiliar((state) => state.episodes?.episodes)
  const months = episodes ? episodeMonths(episodes) : []

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
        <div className="mt-2">
          {months.map((month) => (
            <EpisodeMonth key={month.key} month={month} />
          ))}
        </div>
      )}
    </>
  )
}
