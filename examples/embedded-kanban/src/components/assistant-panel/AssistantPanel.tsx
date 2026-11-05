import { Badge } from '@/components/ui/badge'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { useFamiliar } from '@familiar-ai/client/react'
import { Composer } from './components/composer'
import { TranscriptItem } from './components/transcript-item'

export const AssistantPanel = () => {
  const transcript = useFamiliar((state) => state.transcript)
  const items = transcript?.items ?? []

  return (
    <section
      aria-label="Familiar assistant"
      className="flex h-full min-h-0 w-full flex-col"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <h2 className="font-heading text-sm font-medium">Familiar</h2>
        <Badge variant="outline">Scripted model</Badge>
      </div>
      {/* The scroller moves only its own viewport, so a page embedding this
          one stays where it is. */}
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport aria-label="Conversation">
            <MessageScrollerContent
              aria-busy={transcript?.busy}
              className="gap-3 p-4"
            >
              {items.length === 0 && (
                <p className="text-muted-foreground">
                  Ask about the board or change it. Familiar's tools call the
                  same board operations as the cards, so changes show up both
                  ways.
                </p>
              )}
              {items.map((item) => (
                <MessageScrollerItem
                  key={item.id}
                  messageId={item.id}
                  className="[content-visibility:visible]"
                >
                  <TranscriptItem item={item} />
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      <Composer />
    </section>
  )
}
