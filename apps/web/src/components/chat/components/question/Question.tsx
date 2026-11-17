import { answerFor, shapeOf, type Answer } from '@familiar-ai/client'
import { useRoomStore } from '@familiar-ai/client/react'
import { HandPalmIcon } from '@phosphor-icons/react'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import {
  QuestionFields,
  contentOf,
  initialValues,
  type FieldValues,
} from '../question-fields'
import { toolName } from '../tool-call/label'
import type { QuestionProps } from './types'

/**
 * What a reply is waiting for the person to answer: whether to run a call,
 * a server's question, or a plugin's private one. Approving or submitting
 * lets the reply go on; declining tells the Familiar no. Sending a new
 * message instead declines it.
 */
export const Question = ({ question }: QuestionProps) => {
  const store = useRoomStore()
  const shape = shapeOf(question)
  const [values, setValues] = useState<FieldValues>(() =>
    shape.type === 'form' ? initialValues(shape.form) : {},
  )
  const answer = useMutation({
    mutationFn: (answer: Answer) => store.answer(question, answer),
  })
  const tool = toolName(question.tool)
  const accept = () =>
    answer.mutate(
      answerFor(
        question,
        shape.type === 'form' ? contentOf(shape.form, values) : undefined,
      ),
    )

  const actions = (
    <div className="flex gap-2">
      {shape.type !== 'unsupported' && (
        <Button size="xs" disabled={answer.isPending} onClick={accept}>
          {shape.type === 'form' ? 'Submit' : 'Approve'}
        </Button>
      )}
      <Button
        size="xs"
        variant="outline"
        disabled={answer.isPending}
        onClick={() => answer.mutate({ action: 'decline' })}
      >
        Decline
      </Button>
    </div>
  )

  return (
    <div
      role="group"
      aria-label={`Question from ${tool}`}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Marker className="text-amber-600 dark:text-amber-400">
          <MarkerIcon>
            <HandPalmIcon />
          </MarkerIcon>
          <MarkerContent className="shimmer">
            Waiting for you ·{' '}
            {question.kind === 'tool' ? `Run ${tool}?` : `${tool} asks`}
          </MarkerContent>
        </Marker>
        {shape.type === 'approval' && actions}
      </div>
      <div className="ml-6 flex flex-col gap-3 border-l pl-3">
        {question.kind !== 'tool' && (
          <p className="text-muted-foreground">{question.message}</p>
        )}
        {question.kind === 'private' && (
          <p className="text-muted-foreground">
            What you enter goes only to {question.plugin}, never to the Familiar
            or this chat.
          </p>
        )}
        {question.kind === 'tool' && (
          <pre className="font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {JSON.stringify(question.arguments, null, 2)}
          </pre>
        )}
        {shape.type === 'form' && (
          <QuestionFields
            form={shape.form}
            values={values}
            onChange={setValues}
            disabled={answer.isPending}
          />
        )}
        {shape.type === 'unsupported' && (
          <p className="text-muted-foreground">
            This server asked in a way Familiar can't show yet, so it can only
            be declined.
          </p>
        )}
        {shape.type !== 'approval' && actions}
        {answer.error && (
          <p role="alert" className="text-destructive">
            {answer.error.message}
          </p>
        )}
      </div>
    </div>
  )
}
