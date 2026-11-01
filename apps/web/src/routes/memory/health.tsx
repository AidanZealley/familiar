import {
  createFileRoute,
  useRouter,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import { MemoryHealth } from '@/components/memory-health'
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

const HealthError = ({ error }: ErrorComponentProps) => {
  const router = useRouter()
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Couldn't load memory health</EmptyTitle>
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

const HealthPage = () => <MemoryHealth health={Route.useLoaderData()} />

// Fetched, not mirrored: the numbers are measured when asked, so each visit
// shows them as they are then.
export const Route = createFileRoute('/memory/health')({
  loader: () => familiar.getState().memory.health(),
  // Timings change with every search, so never show a cached visit.
  staleTime: 0,
  component: HealthPage,
  pendingComponent: () => (
    <Empty>
      <Spinner />
    </Empty>
  ),
  errorComponent: HealthError,
})
