import { cn } from 'cn'
import { ClockIcon } from '@phosphor-icons/react'
import { HourglassSpinner } from '@/components/hourglass-spinner'
import { nameOf, useFamiliars } from '@/lib/workspace'
import type { LiveStatusProps } from './types'

const line = 'flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'

/**
 * The most pressing of a room's turns, on one line: who's answering, else
 * queued, else busy in another room. Nothing while no one is working on it.
 * Answering shimmers like the chat's Thinking… marker, rather than spinning.
 */
export const LiveStatus = ({ live, className }: LiveStatusProps) => {
  const familiars = useFamiliars()
  const names = (ids: number[]) =>
    ids.map((id) => nameOf(familiars, id)).join(' and ')

  if (live.running.length) {
    return (
      <span className={cn(line, className)}>
        <span className="shimmer truncate">
          {names(live.running)} {live.running.length > 1 ? 'are' : 'is'}{' '}
          answering
        </span>
      </span>
    )
  }
  if (live.queued.length) {
    return (
      <span className={cn(line, className)}>
        <ClockIcon className="size-3 shrink-0" />
        <span className="truncate">{names(live.queued)} queued</span>
      </span>
    )
  }
  if (live.elsewhere.length) {
    return (
      <span className={cn(line, className)}>
        <HourglassSpinner />
        <span className="truncate">
          {names(live.elsewhere)} busy in another room
        </span>
      </span>
    )
  }
  return null
}
