import { WarningCircleIcon, SquareIcon } from '@phosphor-icons/react'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Message, MessageContent } from '@/components/ui/message'
import { Question } from '../question'
import { ReplyText } from '../reply-text'
import { RetryReply } from './components/retry-reply'
import { Retrying } from '../retrying'
import { Thinking } from '../thinking'
import { ToolCall } from '../tool-call'
import type { ReplyProps } from './types'

export const Reply = ({ reply }: ReplyProps) => {
  // Nothing visible has arrived yet, so the reply is still thinking, unless
  // it's waiting to try the model again or for the person.
  const waiting =
    reply.streaming &&
    !reply.retrying &&
    !reply.text &&
    reply.toolCalls.length === 0 &&
    !reply.questions?.length

  return (
    <Message className="text-sm">
      <MessageContent>
        {(reply.thinking || waiting) && (
          <Thinking text={reply.thinking} active={waiting} />
        )}
        {reply.toolCalls.map((call) => (
          <ToolCall key={call.id} call={call} familiar={reply.familiar} />
        ))}
        {reply.questions?.map((question) => (
          <Question key={question.id} question={question} />
        ))}
        {reply.text && (
          <ReplyText text={reply.text} streaming={reply.streaming} />
        )}
        {reply.retrying && <Retrying retrying={reply.retrying} />}
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
}
