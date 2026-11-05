import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@familiar-ai/core/models/faux'
import { scriptedModels } from '@familiar-ai/core/models/scripted'
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

const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' })

/** Picks the tool call a real model might make for the person's words. */
function plan(words: string) {
  const text = words.trim().replace(/[.!?]+$/, '')
  let match
  if ((match = /^(?:add|create)(?: a)? task:?\s+(.+)$/i.exec(text))) {
    return call('create_task', { title: match[1] })
  }
  if ((match = /^assign (t-\d+) to me$/i.exec(text))) {
    return call('assign_task_to_me', { taskId: match[1].toUpperCase() })
  }
  if ((match = new RegExp(`^move (t-\\d+) to ${status}$`, 'i').exec(text))) {
    return call('move_task', {
      taskId: match[1].toUpperCase(),
      status: STATUS_WORDS[match[2].toLowerCase()],
    })
  }
  if ((match = new RegExp(`^what'?s ${status}$`, 'i').exec(text))) {
    return call('list_tasks', { status: STATUS_WORDS[match[1].toLowerCase()] })
  }
  if (
    /^(?:what'?s on the board|(?:show|list)(?: me)?(?: all| the)? tasks)$/i.test(
      text,
    )
  ) {
    return call('list_tasks', {})
  }
  return fauxAssistantMessage(UNSUPPORTED_REPLY)
}

export const SCRIPTED_MODEL = { provider: 'faux', modelId: 'scripted' }

/**
 * A model registry whose only model stands in for a real one: it answers the
 * person with a tool call, or with words about a tool's result. Familiar runs
 * the tools; the script only decides what to say.
 */
export const createScriptedModels = () =>
  scriptedModels(
    (request) => {
      switch (request.type) {
        case 'message':
          return plan(request.text)
        case 'tool-result':
          return fauxAssistantMessage(
            request.isError
              ? `That didn't work: ${request.output}`
              : request.output,
          )
        default:
          // Compaction and memory upkeep get a plain answer.
          return fauxAssistantMessage('The person tried the task board demo.')
      }
    },
    {
      // Slow enough to see the reply stream, fast enough not to drag.
      tokensPerSecond: 80,
      models: [{ id: SCRIPTED_MODEL.modelId, name: 'Scripted demo' }],
    },
  )
