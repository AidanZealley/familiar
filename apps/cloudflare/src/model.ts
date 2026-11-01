import type { TranscriptContext } from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxResponseFactory,
} from '@earendil-works/pi-ai/providers/faux'
import type { ChatModel } from '@familiar-ai/core'

export const DEV_MODEL: ChatModel = {
  model: { provider: 'faux', modelId: 'faux-1' },
  thinkingLevel: 'low',
}

/** Long enough at the stream's pace to cut off midway. */
export const SLOW_REPLY = Array.from(
  { length: 40 },
  (_, i) => `Part ${i + 1} of a slow reply.`,
).join(' ')

const textOf = (content: string | readonly object[] | undefined) =>
  typeof content === 'string'
    ? content
    : (content ?? [])
        .map((part) => ('text' in part ? String(part.text) : ''))
        .join('')

/**
 * The scripted model's answers, so the Worker needs no model key:
 * `remind YYYY-MM-DD HH:MM <prompt>` schedules a reminder, `slow` streams a
 * long reply, and anything else is echoed.
 */
function reply(context: TranscriptContext) {
  if (
    context.messages.some(
      (message) =>
        message.role === 'system' &&
        textOf(message.content).includes('context summarization'),
    )
  ) {
    return fauxAssistantMessage('A conversation with the dev Worker.')
  }
  const last = context.messages.at(-1)
  if (last?.role === 'toolResult') {
    return fauxAssistantMessage(textOf(last.content))
  }
  const latest = textOf(
    context.messages.findLast(
      (message) =>
        message.role === 'user' &&
        !textOf(message.content).startsWith('Recalled from memory'),
    )?.content,
  )
    // Only the person's words, after the line naming them.
    .replace(/^\[Message from .*\n/, '')
  if (latest.startsWith('[Scheduled')) {
    return fauxAssistantMessage(`Reminder: ${latest.replace(/^\[.*?\] /, '')}`)
  }
  const remind = /^remind (\d{4}-\d\d-\d\d \d\d:\d\d) (.+)$/.exec(latest)
  if (remind) {
    return fauxAssistantMessage(
      fauxToolCall('schedule', { at: remind[1], prompt: remind[2] }),
      { stopReason: 'toolUse' },
    )
  }
  if (latest === 'slow') {
    return fauxAssistantMessage(SLOW_REPLY)
  }
  return fauxAssistantMessage(`You said: ${latest}`)
}

export function devModels() {
  const faux = fauxProvider({
    tokensPerSecond: 40,
    models: [{ id: 'faux-1', name: 'Faux' }],
  })
  // Answers from a queue; this step queues itself again so it never runs out.
  const respond: FauxResponseFactory = (context) => {
    faux.appendResponses([respond])
    return reply(context)
  }
  faux.setResponses([respond])
  const models = createModels()
  models.setProvider(faux.provider)
  return models
}
