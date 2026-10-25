import { createFileRoute } from '@tanstack/react-router'
import { Memory } from '@/components/memory'

export const Route = createFileRoute('/memory')({ component: Memory })
