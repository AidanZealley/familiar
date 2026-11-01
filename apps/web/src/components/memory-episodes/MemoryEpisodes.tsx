import { useFamiliar } from '@familiar-ai/client/react'
import { episodeMonths } from '@/lib/memory'
import { EpisodeMonth } from './components/episode-month'

export const MemoryEpisodes = () => {
  const episodes = useFamiliar((state) => state.memory.episodes?.episodes)
  const months = episodes ? episodeMonths(episodes) : []

  if (episodes && months.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Familiar writes the first episode tonight, after today’s conversation.
      </p>
    )
  }

  return months.map((month) => <EpisodeMonth key={month.key} month={month} />)
}
