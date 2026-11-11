import { cn } from 'cn'
import { CircleAlertIcon } from 'lucide-react'
import { useMemo } from 'react'
import { LiveStatus } from '@/components/live-status'
import { Badge } from '@/components/ui/badge'
import { ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'
import { useWorkspace } from '@/lib/familiar'
import { formatLatest } from '@/lib/format'
import { liveOf, previewOf, useFamiliars } from '@/lib/workspace'
import type { RowSummaryProps } from './types'

/**
 * A conversation's name and when it was last active, over who's working in
 * it, else its latest entry, with what the person hasn't read.
 */
export const RowSummary = ({ title, room, fallback }: RowSummaryProps) => {
  const familiars = useFamiliars()
  const me = useWorkspace((state) => state.me?.id)
  const live = useMemo(() => liveOf(room?.turns), [room?.turns])
  const last = room?.last
  const unread = room?.unread ?? 0
  const hasUnread = unread > 0
  const failed = last?.kind === 'reply' && last.outcome === 'failed'

  return (
    <ItemContent className="min-w-0 gap-0">
      <div className="flex items-baseline gap-2">
        <ItemTitle
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            hasUnread && 'font-semibold',
          )}
        >
          {title}
        </ItemTitle>
        {last && (
          <time
            dateTime={new Date(last.at).toISOString()}
            className={cn(
              'shrink-0 text-[11px] text-muted-foreground tabular-nums',
              hasUnread && 'text-foreground',
            )}
          >
            {formatLatest(last.at)}
          </time>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {room?.turns.length ? (
          <LiveStatus live={live} className="flex-1" />
        ) : last ? (
          <ItemDescription
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1 text-xs',
              failed && 'text-destructive',
              hasUnread && !failed && 'text-foreground',
            )}
          >
            {failed && <CircleAlertIcon className="size-3 shrink-0" />}
            <span className="truncate">{previewOf(last, familiars, me)}</span>
          </ItemDescription>
        ) : (
          fallback && (
            <ItemDescription className="min-w-0 flex-1 truncate text-xs">
              {fallback}
            </ItemDescription>
          )
        )}
        {hasUnread && (
          <Badge
            className="ml-auto h-4 min-w-4 px-1 text-[10px] tabular-nums"
            aria-label={`${unread} unread`}
          >
            {unread}
          </Badge>
        )}
      </div>
    </ItemContent>
  )
}
