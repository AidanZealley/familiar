import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { useRoom } from '@familiar-ai/client/react'
import { TranscriptItem } from './components/transcript-item'
import type { ChatProps } from './types'

/**
 * The shared room, read through whichever client the provider gives it.
 * Every client mirrors the same room, so one view serves
 * everyone; the viewer only decides whose messages are their own.
 */
export const Chat = ({ viewer }: ChatProps) => {
  const connection = useRoom((state) => state.connection)
  const transcript = useRoom((state) => state.transcript)
  const items = transcript?.items ?? []

  return (
    // The scroller moves only its own viewport, so a page embedding this one
    // stays where it is.
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport aria-label="Conversation">
          <MessageScrollerContent
            aria-busy={transcript?.busy}
            className="gap-4 p-4"
          >
            {connection !== 'open' && (
              <p className="text-muted-foreground">Connecting…</p>
            )}
            {connection === 'open' && items.length === 0 && (
              <p className="text-muted-foreground">
                Nobody has said anything yet. Send a message, then choose
                someone else and reply.
              </p>
            )}
            {items.map((item, index) => (
              <MessageScrollerItem
                key={item.id}
                messageId={item.id}
                className="[content-visibility:visible]"
              >
                <TranscriptItem
                  item={item}
                  viewer={viewer}
                  // A tool call and the reply after it read as one turn.
                  continued={
                    item.type === 'reply' && items[index - 1]?.type === 'reply'
                  }
                />
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
