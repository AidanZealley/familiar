import type { Author } from '@familiar-ai/core'
import { createModels, type TranscriptContext } from '@familiar-ai/core/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxResponseFactory,
} from '@familiar-ai/core/models/faux'
import { NOTES } from './people.ts'

/** Prompts the script recognises, for one person, offered in their chat. */
export const suggestedPrompts = (author: Author, people: Author[]) => {
  // The person before them, who has likely said something already.
  const index = people.findIndex((person) => person.id === author.id)
  const previous = people.at(index - 1)
  return [
    `Note for the group: ${NOTES[author.id]}`,
    ...(previous && previous.id !== author.id
      ? [`What did ${previous.name} say?`]
      : []),
    'Who am I?',
    'Count me in',
  ]
}

export const UNSUPPORTED_REPLY = `This demo runs in your browser with a scripted model instead of a real one, so it only understands a few exact phrases. The people, the conversation and the tools are real. Try:

- Note for the group: (anything)
- What did (name) say?
- Who am I?
- Count me in`

type ModelMessage = TranscriptContext['messages'][number]

const textOf = (content: string | readonly object[] | undefined) =>
  typeof content === 'string'
    ? content
    : (content ?? [])
        .map((part) => ('text' in part ? String(part.text) : ''))
        .join('')

/**
 * A person's message as the model reads it: Familiar's first line naming the
 * author the host signed in, then their words.
 */
const said = (message: ModelMessage) => {
  const match = /^\[Message from (.*)\]\n([\s\S]*)$/.exec(
    textOf(message.content),
  )
  if (message.role !== 'user' || !match) {
    return undefined
  }
  const author = JSON.parse(match[1]) as Author | string
  return {
    name: typeof author === 'string' ? author : author.name,
    words: match[2],
  }
}

const call = (name: string) =>
  fauxAssistantMessage(fauxToolCall(name, {}), { stopReason: 'toolUse' })

/** Answers the latest message from what the model was sent, and nothing else. */
function plan(messages: ModelMessage[]) {
  const asked = messages.flatMap((message) => said(message) ?? [])
  const latest = asked.at(-1)
  const text = (latest?.words ?? '').trim().replace(/[.!?]+$/, '')
  if (/^note for the group:\s*\S/i.test(text)) {
    return fauxAssistantMessage(
      `Thanks, ${latest!.name}. Everyone in this conversation can see that.`,
    )
  }
  const match = /^what did (\w+) say$/i.exec(text)
  if (match) {
    const name = match[1].toLowerCase()
    // Earlier messages in this request, newest first.
    const earlier = asked
      .slice(0, -1)
      .findLast((message) => message.name.toLowerCase() === name)
    return fauxAssistantMessage(
      earlier
        ? `${earlier.name} said: "${earlier.words}"\n\nThe script found that in the conversation Familiar sent with this request. It isn't long-term memory.`
        : `I can't see a message from ${match[1]} in this conversation yet.`,
    )
  }
  if (/^who am i$/i.test(text)) {
    return call('who_am_i')
  }
  if (/^count me in$/i.test(text)) {
    return call('count_me_in')
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
    return fauxAssistantMessage('A group tried the shared conversation demo.')
  }
  const last = context.messages.at(-1)
  if (last?.role === 'toolResult') {
    const output = textOf(last.content)
    return fauxAssistantMessage(
      last.isError ? `That didn't work: ${output}` : output,
    )
  }
  return plan(context.messages)
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
