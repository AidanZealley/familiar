import { LoaderCircleIcon } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useMessageScrollerVisibility } from '@/components/ui/message-scroller'
import { familiar, useFamiliar } from '@/lib/familiar'
import { cn } from '@/lib/utils'
import type { OlderMessagesProps } from './types'

const loadOlder = () =>
  void familiar
    .getState()
    .loadOlder()
    .catch(() => {})

/**
 * Loads older messages as the reader nears the top of the chat, and says so
 * while it does. It floats over the messages rather than sitting above them
 * because the scroller keeps the reader's place on a prepend only when the
 * first child was an item.
 */
export const OlderMessages = ({ firstItemIds }: OlderMessagesProps) => {
  const status = useFamiliar((state) => state.history.status)
  const { visibleMessageIds } = useMessageScrollerVisibility()
  const nearTop = firstItemIds.some((id) => visibleMessageIds.includes(id))

  // Runs again when a page arrives, so one that leaves the top in view loads
  // the next. A failure waits for Retry rather than looping.
  useEffect(() => {
    if (nearTop && status === 'more') loadOlder()
  }, [nearTop, status])

  const floating = 'absolute top-3 left-1/2 -translate-x-1/2 text-xs shadow-sm'
  if (status === 'loading')
    return (
      <div
        role="status"
        className={cn(
          floating,
          'flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-muted-foreground',
        )}
      >
        <LoaderCircleIcon className="size-3.5 animate-spin" />
        Loading earlier messages
      </div>
    )
  if (status === 'failed')
    return (
      <Button
        variant="secondary"
        size="sm"
        className={cn(floating, 'border')}
        onClick={loadOlder}
      >
        Couldn't load earlier messages. Retry
      </Button>
    )
  return null
}
