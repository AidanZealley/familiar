import { createFileRoute } from '@tanstack/react-router'
import { MemoryEpisodes } from '@/components/memory-episodes'

export const Route = createFileRoute('/memory/episodes')({
  component: MemoryEpisodes,
})
