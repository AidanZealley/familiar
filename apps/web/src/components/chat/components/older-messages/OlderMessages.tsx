import { useRoom, useRoomStore } from '@familiar-ai/client/react'
import { HourglassSpinner } from '@/components/hourglass-spinner'
import { useCallback, useEffect, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { useMessageScrollerVisibility } from '@/components/ui/message-scroller'
import { cn } from 'cn'
import type { OlderMessagesProps } from './types'

/**
 * Loads older messages as the reader nears the top of the chat, and says so
 * while it does. It floats over the messages rather than sitting above them
 * because the scroller keeps the reader's place on a prepend only when the
 * first child was an item.
 */
export const OlderMessages = ({ firstItemIds }: OlderMessagesProps) => {
  const room = useRoomStore()
  const earlier = useRoom((state) => state.transcript?.earlier ?? false)
  const [loading, startLoading] = useTransition()
  const [failed, setFailed] = useState(false)
  const { visibleMessageIds } = useMessageScrollerVisibility()
  const nearTop = firstItemIds.some((id) => visibleMessageIds.includes(id))
  const load = useCallback(
    () =>
      startLoading(async () => {
        try {
          await room.loadOlder()
          setFailed(false)
        } catch {
          setFailed(true)
        }
      }),
    [room],
  )

  // Runs again when a page arrives, so one that leaves the top in view loads
  // the next. A failure waits for Retry rather than looping.
  useEffect(() => {
    if (nearTop && earlier && !loading && !failed) {
      load()
    }
  }, [load, nearTop, earlier, loading, failed])

  const floating = 'absolute top-3 left-1/2 -translate-x-1/2 text-xs shadow-sm'
  if (loading) {
    return (
      <div
        role="status"
        className={cn(
          floating,
          'flex items-center gap-1.5 border bg-background px-3 py-1 text-muted-foreground',
        )}
      >
        <HourglassSpinner className="size-4" />
        Loading earlier messages
      </div>
    )
  }
  if (failed) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className={cn(floating, 'border')}
        onClick={load}
      >
        Couldn't load earlier messages. Retry
      </Button>
    )
  }
  return null
}
