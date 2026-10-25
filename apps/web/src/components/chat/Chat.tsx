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
import { TranscriptItem } from './components/transcript-item'

export const Chat = () => {
  const view = useFamiliar((state) => state.view)
  const transcript = useMemo(() => view && toTranscript(view), [view])

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent
            aria-busy={transcript?.busy}
            className="gap-4 p-4"
          >
            {transcript?.items.map((item) => (
              <MessageScrollerItem
                key={item.id}
                messageId={item.id}
                // A message starts a turn once Familiar takes it up. A queued
                // one would jump over the reply still streaming above it.
                scrollAnchor={item.type === 'message' && !item.queued}
              >
                <TranscriptItem item={item} />
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>

      <Composer busy={transcript?.busy ?? false} />
    </MessageScrollerProvider>
  )
}
