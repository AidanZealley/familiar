import { createModels, type TranscriptContext } from '@familiar-ai/core/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxResponseFactory,
} from '@familiar-ai/core/models/faux'
import type { Status } from '../board/board.ts'

/** Prompts the script recognises, offered as suggestions in the chat. */
export const SUGGESTED_PROMPTS = [
  "What's in progress?",
  'Add a task: Write the release notes',
  'Assign T-3 to me',
  'Move T-3 to done',
]

export const UNSUPPORTED_REPLY = `This demo runs in your browser with a scripted model instead of a real one, so it only understands a few phrases. The tools and the board are real. Try:

${SUGGESTED_PROMPTS.map((prompt) => `- ${prompt}`).join('\n')}
- What's on the board?`

const STATUS_WORDS: Record<string, Status> = {
  todo: 'todo',
  'to do': 'todo',
  'in progress': 'in_progress',
  done: 'done',
}
const status = '(todo|to do|in progress|done)'

const textOf = (content: string | readonly object[] | undefined) =>
  typeof content === 'string'
    ? content
    : (content ?? [])
        .map((part) => ('text' in part ? String(part.text) : ''))
        .join('')

const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' })

/** Picks the tool call a real model might make for the person's words. */
function plan(words: string) {
  const text = words.trim().replace(/[.!?]+$/, '')
  let match
  if ((match = /^(?:add|create)(?: a)? task:?\s+(.+)$/i.exec(text))) {
    return call('create_task', { title: match[1] })
  }
  if ((match = /\bassign (t-\d+) to me\b/i.exec(text))) {
    return call('assign_task_to_me', { taskId: match[1].toUpperCase() })
  }
  if (
    (match = new RegExp(`\\bmove (t-\\d+) to ${status}\\b`, 'i').exec(text))
  ) {
    return call('move_task', {
      taskId: match[1].toUpperCase(),
      status: STATUS_WORDS[match[2].toLowerCase()],
    })
  }
  if ((match = new RegExp(`\\bwhat'?s ${status}\\b`, 'i').exec(text))) {
    return call('list_tasks', { status: STATUS_WORDS[match[1].toLowerCase()] })
  }
  if (/\b(board|tasks)\b/i.test(text)) {
    return call('list_tasks', {})
  }
  return fauxAssistantMessage(UNSUPPORTED_REPLY)
}

/**
 * Stands in for a model: reads the conversation Familiar sends and answers
 * the way a model would, with a tool call or with words about a tool's result.
 * Familiar runs the tools; this only decides what to say.
 */
export function reply(context: TranscriptContext) {
  // Background work, compaction and memory upkeep, gets a plain answer.
  if (
    context.messages.some(
      (message) =>
        message.role === 'system' &&
        /context summarization|long-term memory of/.test(
          textOf(message.content),
        ),
    )
  ) {
    return fauxAssistantMessage('The person tried the task board demo.')
  }
  // System updates and recall notes are not new messages from the person.
  const messages = context.messages.filter(
    (message) =>
      message.role !== 'system' &&
      !(
        message.role === 'user' &&
        textOf(message.content).startsWith('Recalled from memory')
      ),
  )
  const last = messages.at(-1)
  if (last?.role === 'toolResult') {
    const output = textOf(last.content)
    return fauxAssistantMessage(
      last.isError ? `That didn't work: ${output}` : output,
    )
  }
  const words = textOf(
    messages.findLast((message) => message.role === 'user')?.content,
  )
    // Only the person's words, after the line naming them.
    .replace(/^\[Message from .*\n/, '')
  return plan(words)
}

export const SCRIPTED_MODEL = { provider: 'faux', modelId: 'scripted' }

/** A model registry whose only model is the script above. */
export function createScriptedModels() {
  // Slow enough to see the reply stream, fast enough not to drag.
  const faux = fauxProvider({
    tokensPerSecond: 80,
    models: [{ id: SCRIPTED_MODEL.modelId, name: 'Scripted demo' }],
  })
  // The provider answers from a queue; this step queues itself again.
  const respond: FauxResponseFactory = (context) => {
    faux.appendResponses([respond])
    return reply(context)
  }
  faux.setResponses([respond])
  const models = createModels()
  models.setProvider(faux.provider)
  return models
}
