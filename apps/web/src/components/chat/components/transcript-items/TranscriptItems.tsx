import { useMemo } from 'react'
import { Marker, MarkerContent } from '@/components/ui/marker'
import {
  MessageScrollerItem,
  useMessageScrollerScrollable,
} from '@/components/ui/message-scroller'
import { dayStarts, replyRuns } from './layout'
import { TranscriptItem } from '../transcript-item'
import type { TranscriptItemsProps } from './types'

/** The transcript's items, with the newest turn anchored while it's in view. */
export const TranscriptItems = ({ items, dm, lead }: TranscriptItemsProps) => {
  const runs = useMemo(() => replyRuns(items), [items])
  // Each run by its last item, under which a DM shows the time.
  const ends = useMemo(
    () => new Map([...runs.values()].map((run) => [run.last, run])),
    [runs],
  )
  const days = useMemo(() => dayStarts(items), [items])
  const { end: scrolledUp } = useMessageScrollerScrollable()
  // A message, or a scheduled prompt, starts a turn. When one item replaces another without the count changing, the scroller
  // jumps to the first anchor it hasn't handled, and it never marks loaded
  // history as handled. So only the newest turn is an anchor, and only while
  // the reader is at the end: anywhere else, that jump would pull them away
  // from what they're reading.
  const anchorId = useMemo(
    () =>
      items.findLast(
        (item) => item.type === 'message' || item.type === 'scheduled',
      )?.id,
    [items],
  )

  return items.map((item) => (
    <MessageScrollerItem
      key={item.id}
      messageId={item.id}
      scrollAnchor={!scrolledUp && item.id === anchorId}
      // Lay out every message: deferred ones are estimated at 10rem, and the
      // page jumps as each grows to its real height.
      className="flex flex-col gap-5 [content-visibility:visible]"
    >
      {/* Inside the item, so the scroller's anchors and history stay its own. */}
      {days.has(item.id) && (
        <Marker variant="separator">
          <MarkerContent>{days.get(item.id)}</MarkerContent>
        </Marker>
      )}
      <TranscriptItem
        item={item}
        dm={dm}
        lead={lead}
        run={runs.get(item.id)}
        end={ends.get(item.id)}
      />
    </MessageScrollerItem>
  ))
}
