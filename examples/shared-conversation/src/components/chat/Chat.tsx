import { useEffect, useRef } from 'react'
import { useFamiliar, useTranscript } from '@/demo/react'
import { suggestedPrompts } from '@/demo/script'
import { Composer } from './components/composer'
import { TranscriptItem } from './components/transcript-item'
import type { ChatProps } from './types'

/** One person's view of the shared conversation, through their own client. */
export const Chat = ({ author, people }: ChatProps) => {
  const connection = useFamiliar((state) => state.connection)
  const transcript = useTranscript()
  const items = transcript?.items ?? []
  const scroller = useRef<HTMLDivElement>(null)

  // Follow the conversation as it streams. Scrolling the list itself, not
  // scrollIntoView, keeps a page that embeds this one where it is.
  const last = items.at(-1)
  useEffect(() => {
    const element = scroller.current
    if (element) {
      element.scrollTop = element.scrollHeight
    }
  }, [items.length, last])

  return (
    <section
      aria-label={`${author.name}'s chat`}
      className="flex h-full min-h-0 w-full flex-col"
    >
      <div
        ref={scroller}
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
      >
        {connection !== 'open' && (
          <p className="text-muted-foreground">Connecting…</p>
        )}
        {connection === 'open' && items.length === 0 && (
          <p className="text-muted-foreground">
            Nobody has said anything yet. Send a message as {author.name}, then
            switch to someone else and reply.
          </p>
        )}
        {items.map((item, index) => (
          <TranscriptItem
            key={item.id}
            item={item}
            viewer={author}
            // A tool call and the reply after it read as one turn.
            continued={
              item.type === 'reply' && items[index - 1]?.type === 'reply'
            }
          />
        ))}
      </div>
      <Composer prompts={suggestedPrompts(author, people)} name={author.name} />
    </section>
  )
}
