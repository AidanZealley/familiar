import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import type { ConnectionsErrorProps } from './types'

/** The first load failed; later polls keep the last list instead. */
export const ConnectionsError = ({ error, onRetry }: ConnectionsErrorProps) => (
  <Empty>
    <EmptyHeader>
      <EmptyTitle>Couldn't load connections</EmptyTitle>
      <EmptyDescription>{error.message}</EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <Button variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </EmptyContent>
  </Empty>
)
