import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@familiar-ai/core/models/faux'
import type { Scenario } from './scenario.ts'

const call = (name: string, args: Record<string, string> = {}) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' })

/**
 * Asks for a login in the chat's private form, then lists the saved logins,
 * which Computer → Logins in the Familiar's settings shows too.
 */
export const login: Scenario = {
  start: () => call('request_login', { site: 'https://example.com' }),
  replies: {
    request_login: (output) =>
      output.startsWith('Saved')
        ? call('saved_logins')
        : fauxAssistantMessage(`No login saved: ${output}`),
    saved_logins: (output) =>
      fauxAssistantMessage(
        `My saved logins, without their passwords:\n\n${output}`,
      ),
  },
}
