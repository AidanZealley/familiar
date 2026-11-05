import { createModels, type TranscriptContext } from '@familiar-ai/core/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxResponseFactory,
} from '@familiar-ai/core/models/faux'

// The test Worker's scripted model, apart from the Worker so the tests,
// which run in Node, can import SLOW_REPLY.

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
 * `remind YYYY-MM-DD HH:MM <prompt>` schedules a reminder, `slow` streams a
 * long reply, and anything else is echoed.
 */
function reply(context: TranscriptContext) {
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
  ).replace(/^\[Message from .*\n/, '')
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
  return fauxAssistantMessage(
    latest === 'slow' ? SLOW_REPLY : `You said: ${latest}`,
  )
}

export function scriptedModels() {
  const faux = fauxProvider({ tokensPerSecond: 40 })
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
