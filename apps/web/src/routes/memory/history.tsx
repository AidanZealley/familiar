import { createFileRoute } from '@tanstack/react-router'
import { MemoryHistory } from '@/components/memory-history'

export const Route = createFileRoute('/memory/history')({
  component: MemoryHistory,
})
