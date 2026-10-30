import { CircleAlertIcon, SquareIcon } from 'lucide-react'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Message, MessageContent } from '@/components/ui/message'
import { ReplyText } from '../reply-text'
import { Thinking } from '../thinking'
import { ToolCall } from '../tool-call'
import type { ReplyProps } from './types'

export const Reply = ({ reply }: ReplyProps) => {
  // Nothing visible has arrived yet, so the reply is still thinking.
  const thinking =
    reply.streaming && !reply.text && reply.toolCalls.length === 0

  return (
    <Message className="text-base">
      <MessageContent>
        {(reply.thinking || thinking) && (
          <Thinking text={reply.thinking} active={thinking} />
        )}
        {reply.toolCalls.map((call) => (
          <ToolCall key={call.id} call={call} />
        ))}
        {reply.text && (
          <ReplyText text={reply.text} streaming={reply.streaming} />
        )}
        {reply.stopped && (
          <Marker className="text-muted-foreground">
            <MarkerIcon>
              <SquareIcon />
            </MarkerIcon>
            <MarkerContent>Stopped</MarkerContent>
          </Marker>
        )}
        {reply.error && (
          <Marker role="alert" className="text-destructive">
            <MarkerIcon>
              <CircleAlertIcon />
            </MarkerIcon>
            <MarkerContent>{reply.error}</MarkerContent>
          </Marker>
        )}
      </MessageContent>
    </Message>
  )
}
