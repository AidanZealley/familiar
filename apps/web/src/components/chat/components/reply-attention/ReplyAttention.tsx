import { FamiliarLink } from '@/components/familiar-link'
import { Question } from '../question'
import { Retrying } from '../retrying'
import { ToolCall } from '../tool-call'
import { waitsForPerson } from '../tool-call/waits-for-person'
import type { ReplyAttentionProps } from './types'

export const ReplyAttention = ({ replying, dm }: ReplyAttentionProps) =>
  replying.map(({ familiar, questions, retrying, tools }) => {
    const visibleTools = dm ? tools : tools?.filter(waitsForPerson)
    if (!questions?.length && !retrying && !visibleTools?.length) {
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
        {visibleTools?.map((call) => (
          <ToolCall key={call.id} familiar={familiar} call={call} />
        ))}
        {retrying && <Retrying retrying={retrying} />}
      </div>
    )
  })
