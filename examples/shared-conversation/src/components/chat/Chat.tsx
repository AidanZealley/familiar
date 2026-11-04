import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { useFamiliar, useTranscript } from '@familiar-ai/client/react'
import { TranscriptItems } from './components/transcript-items'
import type { ChatProps } from './types'

/**
 * The shared conversation, read through whichever client the provider
 * gives it. Every client mirrors the same conversation, so one view serves
 * everyone; the viewer only decides whose messages are their own.
 */
export const Chat = ({ viewer }: ChatProps) => {
  const connection = useFamiliar((state) => state.connection)
  const transcript = useTranscript()
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
            <TranscriptItems items={items} viewer={viewer} />
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
