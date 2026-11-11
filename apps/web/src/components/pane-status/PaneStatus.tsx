import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
} from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import type { PaneStatusProps } from './types'

/** In place of a conversation that's loading, or can't be shown. */
export const PaneStatus = ({ problem, reload = false }: PaneStatusProps) =>
  problem === undefined ? (
    <Empty className="flex-1" role="status" aria-label="Loading">
      <Spinner />
    </Empty>
  ) : (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyDescription>{problem}</EmptyDescription>
      </EmptyHeader>
      {reload && (
        <EmptyContent>
          <Button onClick={() => window.location.reload()}>
            Reload Familiar
          </Button>
        </EmptyContent>
      )}
    </Empty>
  )
