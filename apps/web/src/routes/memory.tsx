import { createFileRoute } from '@tanstack/react-router'
import { MemoryLayout } from '@/components/memory-layout'

export const Route = createFileRoute('/memory')({ component: MemoryLayout })
