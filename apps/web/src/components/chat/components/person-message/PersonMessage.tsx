import { ClockIcon } from 'lucide-react'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent, MessageFooter } from '@/components/ui/message'
import type { PersonMessageProps } from './types'

export const PersonMessage = ({ message }: PersonMessageProps) => (
  <Message align="end">
    <MessageContent>
      {/* Pending until Familiar reaches it: an outline, not yet a sent bubble. */}
      <Bubble
        align="end"
        variant={message.queued ? 'outline' : 'default'}
        className="max-w-[min(80%,42rem)]"
      >
        <BubbleContent className="whitespace-pre-wrap">
          {message.text}
        </BubbleContent>
      </Bubble>
      {message.queued && (
        <MessageFooter className="gap-1">
          <ClockIcon className="size-3" />
          Queued
        </MessageFooter>
      )}
    </MessageContent>
  </Message>
)
