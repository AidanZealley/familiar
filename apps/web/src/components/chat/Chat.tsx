import { useCallback, useMemo, useState } from 'react'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { useFamiliar } from '@/lib/familiar'
import { Composer } from './components/composer'
import { OlderMessages } from './components/older-messages'
import { SignIn } from './components/sign-in'
import { TranscriptItems } from './components/transcript-items'

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
  const transcript = useFamiliar((state) => state.transcript)
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
      <div className="-mt-(--chrome) flex h-(--app-height) flex-col">
        <MessageScroller className="flex-1">
          {/* The shared scroller hides its thumb while it scrolls itself, which
              flashes on every streamed update, so keep one colour throughout. */}
          <MessageScrollerViewport className="scroll-pt-(--chrome) scrollbar-thumb-border data-autoscrolling:scrollbar-thumb-border">
            <MessageScrollerContent
              ref={measureScrollMargin}
              aria-busy={transcript?.busy}
              className="mx-auto w-full max-w-(--page-width) gap-4 p-4 pt-[calc(var(--chrome)+1rem)]"
            >
              <TranscriptItems items={transcript?.items ?? []} />
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <OlderMessages firstItemIds={firstItemIds} />
          <MessageScrollerButton />
        </MessageScroller>

        {/* Lined up with the conversation. */}
        <div className="mx-auto w-full max-w-(--page-width)">
          <SignIn />
          <Composer busy={transcript?.busy ?? false} />
        </div>
      </div>
    </MessageScrollerProvider>
  )
}
