import type { ReactNode } from 'react'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'
import { formatTime } from '@/lib/format'
import type { PersonMessageProps } from './types'

/** The message's text, with the spans it mentions someone in picked out. */
const withMentions = ({
  text,
  mentions = [],
}: PersonMessageProps['message']) => {
  const parts: ReactNode[] = []
  let at = 0
  for (const mention of mentions.toSorted((a, b) => a.start - b.start)) {
    parts.push(
      text.slice(at, mention.start),
      <span
        key={mention.start}
        className="bg-primary/25 box-decoration-clone px-0.5 font-medium dark:bg-primary/70"
      >
        {text.slice(mention.start, mention.end)}
      </span>,
    )
    at = mention.end
  }
  return [...parts, text.slice(at)]
}

/** A person's message: no name or avatar, only what they said and when. */
export const PersonMessage = ({ message }: PersonMessageProps) => (
  <Message align="end">
    <MessageContent className="items-end gap-1">
      <Bubble
        variant="secondary"
        align="end"
        className="max-w-[min(80%,42rem)]"
      >
        <BubbleContent className="text-sm whitespace-pre-wrap">
          {withMentions(message)}
        </BubbleContent>
      </Bubble>
      <time
        dateTime={new Date(message.at).toISOString()}
        className="font-heading text-[0.7rem] text-muted-foreground tabular-nums"
      >
        {formatTime(message.at)}
      </time>
    </MessageContent>
  </Message>
)
