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

const saved = () =>
  fauxAssistantMessage(
    'Saved. The **Memory** pages show it all: what each of us knows about you, and how it changed.',
  )

export const seed: Scenario = {
  start: () =>
    fauxAssistantMessage([fauxToolCall('seed_memory', {})], {
      stopReason: 'toolUse',
    }),
  replies: { seed_memory: saved },
}
