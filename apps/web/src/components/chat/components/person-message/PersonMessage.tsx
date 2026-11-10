import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'
import type { PersonMessageProps } from './types'

export const PersonMessage = ({ message }: PersonMessageProps) => (
  <Message align="end">
    <MessageContent>
      <Bubble align="end" className="max-w-[min(80%,42rem)]">
        <BubbleContent className="text-sm whitespace-pre-wrap">
          {message.text}
        </BubbleContent>
      </Bubble>
    </MessageContent>
  </Message>
)
