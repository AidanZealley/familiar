import { FamiliarTurn } from '../familiar-turn'
import { Question } from '../question'
import { Retrying } from '../retrying'
import { Thinking } from '../thinking'
import { ToolCall } from '../tool-call'
import type { LiveRepliesProps } from './types'

export const LiveReplies = ({ replying, dm }: LiveRepliesProps) =>
  replying.map(({ familiar, questions, retrying, tools }) => {
    const thinking = !questions?.length && !retrying && !tools?.length
    return (
      <FamiliarTurn key={familiar} familiar={familiar} dm={dm} showIdentity>
        {questions?.map((question) => (
          <Question key={question.id} question={question} />
        ))}
        {tools?.map((call) => (
          <ToolCall key={call.id} familiar={familiar} call={call} />
        ))}
        {thinking && <Thinking />}
        {retrying && <Retrying retrying={retrying} />}
      </FamiliarTurn>
    )
  })
