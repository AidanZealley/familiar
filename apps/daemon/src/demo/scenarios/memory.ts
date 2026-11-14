import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@familiar-ai/core/models/faux'
import type { Scenario } from './scenario.ts'

export const memory: Scenario = {
  start: () =>
    fauxAssistantMessage(fauxToolCall('recall', { query: 'morning drink' }), {
      stopReason: 'toolUse',
    }),
  replies: {
    recall: (output) =>
      fauxAssistantMessage(`Here's what I found:\n\n${output}`),
  },
}
