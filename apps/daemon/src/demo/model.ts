import type { TranscriptContext } from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  type FauxResponseFactory,
} from '@earendil-works/pi-ai/providers/faux'
import { SEED_MESSAGE } from './seed.ts'
import { markdownReply, tool, slow, error } from './scenarios/chat.ts'
import { compact } from './scenarios/compaction.ts'
import { key } from './scenarios/connections.ts'
import { mcp } from './scenarios/mcp.ts'
import { memory, seed } from './scenarios/memory.ts'
import { remind, scheduledReply } from './scenarios/schedules.ts'
import { textOf } from './text.ts'
import type { Scenario } from './types.ts'

const scenarios = { tool, memory, remind, key, mcp, slow, compact, error }
const replies: NonNullable<Scenario['replies']> = Object.assign(
  {},
  ...[...Object.values(scenarios), seed].map((scenario) => scenario.replies),
)

export function reply(context: TranscriptContext) {
  if (
    context.messages.some(
      (message) =>
        message.role === 'system' &&
        textOf(message.content).includes('context summarization assistant'),
    )
  ) {
    return fauxAssistantMessage('The person tried the demo scenarios.')
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
    return (
      replies[last.toolName]?.(textOf(last.content), context) ??
      fauxAssistantMessage(textOf(last.content))
    )
  }
  const latest = textOf(
    messages.findLast((message) => message.role === 'user')?.content,
  )
  if (latest.startsWith('[Scheduled')) {
    return scheduledReply()
  }
  if (latest === SEED_MESSAGE) {
    return seed.start()
  }
  const matched = Object.entries(scenarios).find(([word]) =>
    new RegExp(`\\b${word}\\b`).test(latest.toLowerCase()),
  )
  return matched ? matched[1].start() : fauxAssistantMessage(markdownReply)
}

export function createDemoModels() {
  // Readable, but fast enough that a whole reply doesn't drag.
  const faux = fauxProvider({ tokensPerSecond: 40 })
  // The provider answers from a queue, one step per request. This step reads
  // the request and queues itself again, so the script never runs out.
  const respond: FauxResponseFactory = (context) => {
    faux.appendResponses([respond])
    return reply(context)
  }
  faux.setResponses([respond])

  const models = createModels()
  models.setProvider(faux.provider)

  return models
}
