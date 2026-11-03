import { ClockIcon, LoaderIcon } from 'lucide-react'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from '@/components/ui/message'
import { PersonAvatar } from '@/components/person-avatar'
import { ToolCallCard } from '../tool-call-card'
import type { TranscriptItemProps } from './types'

export const TranscriptItem = ({
  item,
  viewer,
  continued,
}: TranscriptItemProps) => {
  switch (item.type) {
    case 'message': {
      // The author as the host signed them in when they sent this.
      const author =
        typeof item.author === 'string' ? { name: item.author } : item.author
      const align = 'id' in author && author.id === viewer.id ? 'end' : 'start'
      return (
        <Message align={align}>
          <MessageAvatar>
            <PersonAvatar author={author} />
          </MessageAvatar>
          <MessageContent>
            <MessageHeader>{author.name}</MessageHeader>
            {/* Waiting for Familiar to reach it: an outline, not yet sent. */}
            <Bubble
              align={align}
              variant={
                item.queued ? 'outline' : align === 'end' ? 'default' : 'muted'
              }
            >
              <BubbleContent className="whitespace-pre-wrap">
                {item.text}
              </BubbleContent>
            </Bubble>
            {item.queued && (
              <MessageFooter className="gap-1">
                <ClockIcon className="size-3" aria-hidden />
                Queued
              </MessageFooter>
            )}
          </MessageContent>
        </Message>
      )
    }
    case 'reply':
      return (
        <Message>
          <MessageContent>
            {!continued && (
              <MessageHeader className="px-0 text-foreground">
                Familiar
              </MessageHeader>
            )}
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
