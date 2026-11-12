import { createFileRoute } from '@tanstack/react-router'
import { HomePane } from '@/components/home-pane'

/** Beside the sidebar on a wide screen; a phone shows only the sidebar here. */
export const Route = createFileRoute('/')({ component: HomePane })
