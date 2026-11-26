import { answerFor, shapeOf, type Answer } from '@familiar-ai/client'
import { useRoomStore } from '@familiar-ai/client/react'
import { HandPalmIcon } from '@phosphor-icons/react'
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
 * or a server's question. Approving or submitting lets the reply go on;
 * declining tells the Familiar no. Sending a new message instead declines it.
 */
export const Question = ({ question }: QuestionProps) => {
  const store = useRoomStore()
  const shape = shapeOf(question)
  const [values, setValues] = useState<FieldValues>(() =>
    shape.type === 'form' ? initialValues(shape.form) : {},
  )
  // Not a mutation: its cache would keep a private answer's values.
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const submit = async (answer: Answer) => {
    setPending(true)
    setError(undefined)
    try {
      await store.answer(question, answer)
      setValues({})
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not submit the answer.',
      )
    } finally {
      setPending(false)
    }
  }
  const tool = toolName(question.tool)
  const accept = () =>
    void submit(
      answerFor(
        question,
        shape.type === 'form' ? contentOf(shape.form, values) : undefined,
      ),
    )

  const actions = (
    <div className="flex gap-2">
      {shape.type !== 'unsupported' && (
        <Button size="xs" disabled={pending} onClick={accept}>
          {question.kind === 'private'
            ? 'Submit privately'
            : shape.type === 'form'
              ? 'Submit'
              : 'Approve'}
        </Button>
      )}
      <Button
        size="xs"
        variant="outline"
        disabled={pending}
        onClick={() => void submit({ action: 'decline' })}
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
      <div className="ml-6 flex flex-col gap-3 border-l pl-3 wrap-anywhere">
        {question.kind !== 'tool' && (
          <p className="text-muted-foreground">{question.message}</p>
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
            disabled={pending}
          />
        )}
        {shape.type === 'unsupported' && (
          <p className="text-muted-foreground">
            This server asked in a way Familiar can't show yet, so it can only
            be declined.
          </p>
        )}
        {shape.type !== 'approval' && actions}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
