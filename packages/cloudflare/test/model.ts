import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@familiar-ai/core/models/faux'
import {
  scriptedModels,
  type ScriptedRequest,
} from '@familiar-ai/core/models/scripted'

// The test Worker's scripted model, apart from the Worker so the tests,
// which run in Node, can import its replies.

/** Long enough at the stream's pace to cut off midway. */
export const SLOW_REPLY = Array.from(
  { length: 40 },
  (_, i) => `Part ${i + 1} of a slow reply.`,
).join(' ')

/** The reply to every due reminder. */
export const REMINDER = 'Reminder.'

/**
 * `remind YYYY-MM-DD HH:MM <prompt>` schedules a reminder, `slow` streams a
 * long reply, and anything else is echoed.
 */
function reply(request: ScriptedRequest) {
  switch (request.type) {
    case 'tool-result':
      return fauxAssistantMessage(request.output)
    case 'scheduled':
      return fauxAssistantMessage(REMINDER)
    case 'background':
      return fauxAssistantMessage('Nothing to note.')
    case 'handoff':
      return fauxAssistantMessage(`On it: ${request.note}`)
    case 'message': {
      const remind = /^remind (\S+ \S+) (.+)$/.exec(request.text)
      if (remind) {
        return fauxAssistantMessage(
          fauxToolCall('schedule', { at: remind[1], prompt: remind[2] }),
          { stopReason: 'toolUse' },
        )
      }
      return fauxAssistantMessage(
        request.text === 'slow' ? SLOW_REPLY : `You said: ${request.text}`,
      )
    }
  }
}

export const testModels = () => scriptedModels(reply, { tokensPerSecond: 40 })
