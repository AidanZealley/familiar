import { useMemo } from 'react'
import {
  MessageScrollerItem,
  useMessageScrollerScrollable,
} from '@/components/ui/message-scroller'
import { turnTimes } from '../../times'
import { TranscriptItem } from '../transcript-item'
import type { TranscriptItemsProps } from './types'

/** The transcript's items, with the newest turn anchored while it's in view. */
export const TranscriptItems = ({ items }: TranscriptItemsProps) => {
  const times = useMemo(() => turnTimes(items), [items])
  const { end: scrolledUp } = useMessageScrollerScrollable()
  // A message, or a scheduled prompt, starts a turn once Familiar takes it
  // up; a queued one would jump over the reply still streaming above it.
  // When one item replaces another without the count changing, the scroller
  // jumps to the first anchor it hasn't handled, and it never marks loaded
  // history as handled. So only the newest turn is an anchor, and only while
  // the reader is at the end: anywhere else, that jump would pull them away
  // from what they're reading.
  const anchorId = useMemo(
    () =>
      items.findLast(
        (item) =>
          (item.type === 'message' || item.type === 'scheduled') &&
          !item.queued,
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
      className="[content-visibility:visible]"
    >
      <TranscriptItem item={item} time={times.get(item.id)} />
    </MessageScrollerItem>
  ))
}
