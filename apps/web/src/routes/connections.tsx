import { createFileRoute } from '@tanstack/react-router'
import { ConnectionsPage } from '@/components/connections-page'
import { familiar } from '@/lib/familiar'

// Fetched, not mirrored: connections change only when the owner changes them
// here, so the page reloads them after each change.
export const Route = createFileRoute('/connections')({
  loader: () => familiar.getState().connections(),
  component: ConnectionsPage,
})
