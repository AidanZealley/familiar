import { toTranscript } from '@familiar/client'
import { useMemo } from 'react'
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
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      {/* The chat scrolls inside the screen below the header, so the
          scroller can keep the newest message in view. */}
      <div className="flex h-[calc(100svh-var(--chrome))] flex-col">
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent
              aria-busy={transcript?.busy}
              className="mx-auto w-full max-w-5xl gap-4 p-4"
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
        <div className="mx-auto w-full max-w-5xl">
          <Composer busy={transcript?.busy ?? false} />
        </div>
      </div>
    </MessageScrollerProvider>
  )
}
