import { useMemo } from 'react'
import {
  MessageScrollerItem,
  useMessageScrollerScrollable,
} from '@/components/ui/message-scroller'
import { TranscriptItem } from '../transcript-item'
import type { TranscriptItemsProps } from './types'

/** The transcript's items, with the newest turn anchored while it's in view. */
export const TranscriptItems = ({ items, viewer }: TranscriptItemsProps) => {
  const { end: scrolledUp } = useMessageScrollerScrollable()
  // As in Familiar's web UI: only the newest message Familiar has taken up
  // anchors, and only while the reader is at the end, so a queued message
  // never jumps over the reply still streaming above it.
  const anchorId = useMemo(
    () => items.findLast((item) => item.type === 'message' && !item.queued)?.id,
    [items],
  )

  return items.map((item, index) => (
    <MessageScrollerItem
      key={item.id}
      messageId={item.id}
      scrollAnchor={!scrolledUp && item.id === anchorId}
      className="[content-visibility:visible]"
    >
      <TranscriptItem
        item={item}
        viewer={viewer}
        // A tool call and the reply after it read as one turn.
        continued={item.type === 'reply' && items[index - 1]?.type === 'reply'}
      />
    </MessageScrollerItem>
  ))
}
