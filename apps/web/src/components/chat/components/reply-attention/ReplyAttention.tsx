import { FamiliarLink } from '@/components/familiar-link'
import { Question } from '../question'
import { Retrying } from '../retrying'
import { ToolCall } from '../tool-call'
import { waitsForPerson } from '../tool-call/waits-for-person'
import type { ReplyAttentionProps } from './types'

export const ReplyAttention = ({ replying, dm }: ReplyAttentionProps) =>
  replying.map(({ familiar, questions, retrying, tools }) => {
    const waiting = tools?.filter(waitsForPerson) ?? []
    if (!questions?.length && !retrying && !waiting.length) {
      return null
    }
    return (
      <div key={familiar} className="flex flex-col gap-1.5 text-sm">
        {!dm && (
          <p className="font-heading text-xs">
            <FamiliarLink id={familiar} />
          </p>
        )}
        {questions?.map((question) => (
          <Question key={question.id} question={question} />
        ))}
        {waiting.map((slot) => (
          <ToolCall
            key={slot.callId}
            familiar={familiar}
            call={{
              id: slot.callId,
              name: slot.name,
              status: 'running',
              arguments: {},
              output: slot.output ?? '',
              details: slot.details,
            }}
          />
        ))}
        {retrying && <Retrying retrying={retrying} />}
      </div>
    )
  })
