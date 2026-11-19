import { WarningCircleIcon, SquareIcon } from '@phosphor-icons/react'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Message, MessageContent } from '@/components/ui/message'
import { ReplyText } from '../reply-text'
import { RetryReply } from './components/retry-reply'
import { Thinking } from '../thinking'
import { ToolCall } from '../tool-call'
import type { ReplyProps } from './types'

export const Reply = ({ reply }: ReplyProps) => (
  <Message className="text-sm">
    <MessageContent>
      {reply.thinking && <Thinking text={reply.thinking} />}
      {reply.toolCalls.map((call) => (
        <ToolCall key={call.id} call={call} familiar={reply.familiar} />
      ))}
      {reply.text && <ReplyText text={reply.text} mentions={reply.mentions} />}
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
            <WarningCircleIcon />
          </MarkerIcon>
          <MarkerContent>{reply.error}</MarkerContent>
        </Marker>
      )}
      {reply.retry !== undefined && <RetryReply reply={reply.retry} />}
    </MessageContent>
  </Message>
)
