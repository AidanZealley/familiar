import { createFileRoute } from '@tanstack/react-router'
import { SchedulesPage } from '@/components/schedules-page'

export const Route = createFileRoute('/schedules')({ component: SchedulesPage })
