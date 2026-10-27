import { createFileRoute } from '@tanstack/react-router'
import { MemoryFacts } from '@/components/memory-facts'

export const Route = createFileRoute('/memory/')({ component: MemoryFacts })
