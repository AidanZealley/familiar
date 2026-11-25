import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'
import { formatTime } from '@/lib/format'
import { withMentions } from './withMentions'
import { MessageImages } from '../message-images'
import type { PersonMessageProps } from './types'

/**
 * A person's message: no name or avatar, only what they said, any images
 * above it, and when.
 */
export const PersonMessage = ({ message }: PersonMessageProps) => (
  <Message align="end">
    <MessageContent className="items-end gap-1">
      {message.images && <MessageImages images={message.images} />}
      {message.text && (
        <Bubble
          variant="secondary"
          align="end"
          className="max-w-[min(80%,42rem)]"
        >
          <BubbleContent className="text-sm whitespace-pre-wrap">
            {withMentions(message)}
          </BubbleContent>
        </Bubble>
      )}
      <time
        dateTime={new Date(message.at).toISOString()}
        className="font-heading text-[0.7rem] text-muted-foreground tabular-nums"
      >
        {formatTime(message.at)}
      </time>
    </MessageContent>
  </Message>
)
