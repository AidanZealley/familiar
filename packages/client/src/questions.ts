import type {
  Answer,
  Form,
  FormContent,
  Question,
} from '@familiar-ai/core/http'

/**
 * How a question is answered in a chat UI:
 * - `approval`: Approve or Decline. Familiar asking whether to run a call,
 *   or a server's form of one yes/no `field`, which approving sets to true.
 * - `form`: the server's fields, then Submit or Decline.
 * - `unsupported`: a form Familiar can't show, which can only be declined.
 */
export type QuestionShape =
  | { type: 'approval'; field?: string }
  | { type: 'form'; form: Form }
  | { type: 'unsupported' }

export function shapeOf(question: Question): QuestionShape {
  if (question.kind === 'tool') {
    return { type: 'approval' }
  }
  const { form } = question
  if (!form) {
    return { type: 'unsupported' }
  }
  const [only] = form
  return form.length === 1 && only?.type === 'boolean'
    ? { type: 'approval', field: only.name }
    : { type: 'form', form }
}

/** The answer for approving `question`, or submitting `content` to its form. */
export function answerFor(question: Question, content?: FormContent): Answer {
  const shape = shapeOf(question)
  if (shape.type === 'approval') {
    return shape.field === undefined
      ? { action: 'accept' }
      : { action: 'accept', content: { [shape.field]: true } }
  }
  return { action: 'accept', content: content ?? {} }
}
