import { LoaderIcon } from 'lucide-react'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'
import { ToolCallCard } from '../tool-call-card'
import type { TranscriptItemProps } from './types'

export const TranscriptItem = ({ item }: TranscriptItemProps) => {
  switch (item.type) {
    case 'message':
      return (
        <Message align="end">
          <MessageContent>
            <Bubble align="end">
              <BubbleContent className="whitespace-pre-wrap">
                {item.text}
              </BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      )
    case 'reply':
      return (
        <Message>
          <MessageContent>
            {item.toolCalls.map((call) => (
              <ToolCallCard key={call.id} call={call} />
            ))}
            {item.text && <p className="whitespace-pre-wrap">{item.text}</p>}
            {item.error && (
              <p role="alert" className="text-destructive">
                {item.error}
              </p>
            )}
          </MessageContent>
        </Message>
      )
    case 'waiting':
      return (
        <LoaderIcon
          aria-label="Familiar is replying"
          className="size-4 animate-spin text-muted-foreground"
        />
      )
    default:
      return null
  }
}
