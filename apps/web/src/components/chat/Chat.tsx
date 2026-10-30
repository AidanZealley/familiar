import { toTranscript } from '@familiar/client'
import { useCallback, useMemo, useState } from 'react'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { useFamiliar } from '@/lib/familiar'
import { Composer } from './components/composer'
import { OlderMessages } from './components/older-messages'
import { TranscriptItem } from './components/transcript-item'
import { turnTimes } from './times'

export const Chat = () => {
  const [scrollMargin, setScrollMargin] = useState(0)
  const measureScrollMargin = useCallback((content: HTMLDivElement | null) => {
    if (!content) {
      return
    }
    // The scroller positions anchors itself, so give it the same header
    // clearance as the content, including the device's safe area.
    const measure = () =>
      setScrollMargin(Number.parseFloat(getComputedStyle(content).paddingTop))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [])
  const view = useFamiliar((state) => state.view)
  const history = useFamiliar((state) => state.history.entries)
  const transcript = useMemo(
    () => view && toTranscript(view, history),
    [view, history],
  )
  const times = useMemo(() => turnTimes(transcript?.items ?? []), [transcript])
  const firstItemIds = useMemo(
    () => transcript?.items.slice(0, 3).map((item) => item.id) ?? [],
    [transcript],
  )

  return (
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition="end"
      scrollMargin={scrollMargin}
    >
      {/* Extend the scroller behind the glass header; content padding keeps
          the first message clear of it at the start of the conversation. */}
      <div className="-mt-(--chrome) flex h-svh flex-col">
        <MessageScroller className="flex-1">
          <MessageScrollerViewport className="scroll-pt-(--chrome)">
            <MessageScrollerContent
              ref={measureScrollMargin}
              aria-busy={transcript?.busy}
              className="mx-auto w-full max-w-(--page-width) gap-4 p-4 pt-[calc(var(--chrome)+1rem)]"
            >
              {transcript?.items.map((item) => (
                <MessageScrollerItem
                  key={item.id}
                  messageId={item.id}
                  // A message, or a scheduled prompt, starts a turn once
                  // Familiar takes it up. A queued one would jump over the
                  // reply still streaming above it.
                  scrollAnchor={
                    (item.type === 'message' || item.type === 'scheduled') &&
                    !item.queued
                  }
                >
                  <TranscriptItem item={item} time={times.get(item.id)} />
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <OlderMessages firstItemIds={firstItemIds} />
          <MessageScrollerButton />
        </MessageScroller>

        {/* Lined up with the conversation. */}
        <div className="mx-auto w-full max-w-(--page-width)">
          <Composer busy={transcript?.busy ?? false} />
        </div>
      </div>
    </MessageScrollerProvider>
  )
}
