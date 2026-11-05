import type { Author } from '@familiar-ai/core'
import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@familiar-ai/core/models/faux'
import {
  scriptedModels,
  type ScriptedMessage,
} from '@familiar-ai/core/models/scripted'
import { PEOPLE } from './people.ts'

/** Something each person might tell the group, offered as a suggestion. */
const NOTES: Record<string, string> = {
  ana: 'I can bring dessert',
  ben: "I'll book a table for 7pm",
  chloe: "I'm vegetarian",
}

/** Prompts the script recognises, for one person, offered in their chat. */
export const suggestedPrompts = (author: Author) => {
  // The person before them, who has likely said something already.
  const previous = PEOPLE.at(
    PEOPLE.findIndex(({ id }) => id === author.id) - 1,
  )!
  return [
    `Note for the group: ${NOTES[author.id]}`,
    `What did ${previous.name} say?`,
    'Who am I?',
    'Count me in',
  ]
}

export const UNSUPPORTED_REPLY = `This demo runs in your browser with a scripted model instead of a real one, so it only understands a few exact phrases. The people, the conversation and the tools are real. Try:

- Note for the group: (anything)
- What did (name) say?
- Who am I?
- Count me in`

const call = (name: string) =>
  fauxAssistantMessage(fauxToolCall(name, {}), { stopReason: 'toolUse' })

/** Answers a person's message from what the model was sent, and nothing else. */
function plan({ author, text, earlier }: ScriptedMessage) {
  const words = text.trim().replace(/[.!?]+$/, '')
  if (/^note for the group:\s*\S/i.test(words)) {
    return fauxAssistantMessage(
      `Thanks, ${author.name}. Everyone in this conversation can see that.`,
    )
  }
  const match = /^what did (\w+) say$/i.exec(words)
  if (match) {
    const name = match[1].toLowerCase()
    // Earlier messages in this request, newest first.
    const found = earlier.findLast(
      (message) => message.author.name.toLowerCase() === name,
    )
    return fauxAssistantMessage(
      found
        ? `${found.author.name} said: "${found.text}"\n\nThe script found that in the conversation Familiar sent with this request. It isn't long-term memory.`
        : `I can't see a message from ${match[1]} in this conversation yet.`,
    )
  }
  if (/^who am i$/i.test(words)) {
    return call('who_am_i')
  }
  if (/^count me in$/i.test(words)) {
    return call('count_me_in')
  }
  return fauxAssistantMessage(UNSUPPORTED_REPLY)
}

export const SCRIPTED_MODEL = { provider: 'faux', modelId: 'scripted' }

/**
 * A model registry whose only model stands in for a real one: it answers
 * each person with words or a tool call, or with words about a tool's result.
 * Familiar runs the tools; the script only decides what to say.
 */
export const createScriptedModels = () =>
  scriptedModels(
    (request) => {
      switch (request.type) {
        case 'message':
          return plan(request)
        case 'tool-result':
          return fauxAssistantMessage(
            request.isError
              ? `That didn't work: ${request.output}`
              : request.output,
          )
        default:
          // Compaction and memory upkeep get a plain answer.
          return fauxAssistantMessage(
            'A group tried the shared conversation demo.',
          )
      }
    },
    {
      // Slow enough to see the reply stream, fast enough not to drag.
      tokensPerSecond: 80,
      models: [{ id: SCRIPTED_MODEL.modelId, name: 'Scripted demo' }],
    },
  )
