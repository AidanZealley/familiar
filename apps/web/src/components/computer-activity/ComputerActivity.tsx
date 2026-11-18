import { useQuery } from '@tanstack/react-query'
import { cn } from 'cn'
import { StatusDot } from '@/components/status-dot'
import {
  computerDetailQuery,
  computerQuery,
  computerStates,
  describeCall,
} from '@/lib/computers'
import type { ComputerActivityProps } from './types'

/**
 * What a Familiar's computer is doing, in a line under its screen: its
 * latest call while one runs, or its state. The state is the status poll's,
 * as the screen's is; a look in detail adds the call only while it agrees.
 */
export const ComputerActivity = ({
  familiar,
  className,
}: ComputerActivityProps) => {
  const { data: status, isError: unreachable } = useQuery(
    computerQuery(familiar.id),
  )
  const { data: detail } = useQuery(computerDetailQuery(familiar.id))
  // A failed poll keeps the last answer, which may be stale.
  const state = unreachable
    ? { label: 'Not connected', tone: 'off' as const }
    : status && computerStates[status.state]
  const call =
    !unreachable &&
    status?.state === 'running' &&
    detail?.status?.state === 'running'
      ? detail.doing?.at(-1)
      : undefined

  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-muted-foreground',
        className,
      )}
    >
      {state && <StatusDot tone={state.tone} />}
      <span className={cn('truncate', call && 'shimmer')}>
        {call ? describeCall(call) : state?.label}
      </span>
    </span>
  )
}
