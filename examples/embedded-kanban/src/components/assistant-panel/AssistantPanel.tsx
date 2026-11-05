import { useEffect, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { useFamiliar } from '@familiar-ai/client/react'
import { Composer } from './components/composer'
import { TranscriptItem } from './components/transcript-item'

export const AssistantPanel = () => {
  const transcript = useFamiliar((state) => state.transcript)
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
      aria-label="Familiar assistant"
      className="flex h-full min-h-0 w-full flex-col"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <h2 className="font-heading text-sm font-medium">Familiar</h2>
        <Badge variant="outline">Scripted model</Badge>
      </div>
      <div
        ref={scroller}
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
      >
        {items.length === 0 && (
          <p className="text-muted-foreground">
            Ask about the board or change it. Familiar's tools call the same
            board operations as the cards, so changes show up both ways.
          </p>
        )}
        {items.map((item) => (
          <TranscriptItem key={item.id} item={item} />
        ))}
      </div>
      <Composer />
    </section>
  )
}
