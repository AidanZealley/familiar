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
 * latest call while one runs, or its state.
 */
export const ComputerActivity = ({
  familiar,
  className,
}: ComputerActivityProps) => {
  const { data: status } = useQuery(computerQuery(familiar.id))
  const { data: detail } = useQuery(computerDetailQuery(familiar.id))
  const current = detail?.status ?? status
  const state = current && computerStates[current.state]
  const call = current?.state === 'running' ? detail?.doing?.at(-1) : undefined

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
