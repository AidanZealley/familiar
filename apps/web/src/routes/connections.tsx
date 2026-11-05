import { createFileRoute } from '@tanstack/react-router'
import {
  ConnectionsError,
  ConnectionsPage,
  connectionsQuery,
} from '@/components/connections-page'
import { Empty } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { queryClient } from '@/lib/familiar'

type ConnectionsSearch = {
  /** The selected connection, as `kind:name`. */
  id?: string
  q?: string
}

const text = (value: unknown) =>
  typeof value === 'string' && value ? value : undefined

export const Route = createFileRoute('/connections')({
  validateSearch: (search): ConnectionsSearch => ({
    id: text(search.id),
    q: text(search.q),
  }),
  loader: () => queryClient.ensureQueryData(connectionsQuery),
  component: ConnectionsPage,
  pendingComponent: () => (
    <Empty>
      <Spinner />
    </Empty>
  ),
  errorComponent: ConnectionsError,
})
