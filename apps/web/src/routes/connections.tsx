import {
  createFileRoute,
  useRouter,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import { ConnectionsPage } from '@/components/connections-page'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { familiar } from '@/lib/familiar'

type ConnectionsSearch = {
  /** The selected connection, as `kind:name`. */
  id?: string
  q?: string
}

const text = (value: unknown) =>
  typeof value === 'string' && value ? value : undefined

const ConnectionsError = ({ error }: ErrorComponentProps) => {
  const router = useRouter()
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Couldn't load connections</EmptyTitle>
        <EmptyDescription>{(error as Error).message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={() => void router.invalidate()}>
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  )
}

// Fetched, not mirrored: the page reloads them after each change, and polls
// while it's open, because servers connect and drop in the background.
export const Route = createFileRoute('/connections')({
  validateSearch: (search): ConnectionsSearch => ({
    id: text(search.id),
    q: text(search.q),
  }),
  loader: () => familiar.getState().connections(),
  component: ConnectionsPage,
  pendingComponent: () => (
    <Empty>
      <Spinner />
    </Empty>
  ),
  errorComponent: ConnectionsError,
})
