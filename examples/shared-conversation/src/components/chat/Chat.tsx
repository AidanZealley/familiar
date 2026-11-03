import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { useFamiliar, useTranscript } from '@/demo/react'
import { cn } from '@/lib/utils'
import { TranscriptItems } from './components/transcript-items'
import type { ChatProps } from './types'

/** One person's view of the shared conversation, through their own client. */
export const Chat = ({ author, hidden }: ChatProps) => {
  const connection = useFamiliar((state) => state.connection)
  const transcript = useTranscript()
  const items = transcript?.items ?? []

  return (
    // Hidden but still laid out, so its scroller keeps following the end
    // while another person is chosen.
    <section
      inert={hidden}
      aria-label={`${author.name}'s chat`}
      className={cn(
        'col-start-1 row-start-1 flex min-h-0 flex-col',
        hidden && 'invisible',
      )}
    >
      {/* The scroller moves only its own viewport, so a page embedding this
          one stays where it is. */}
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="flex-1">
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
                  Nobody has said anything yet. Send a message as {author.name},
                  then pick someone else and reply.
                </p>
              )}
              <TranscriptItems items={items} viewer={author} />
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
    </section>
  )
}
