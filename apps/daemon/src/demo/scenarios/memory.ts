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
    'Saved. The **Memory** pages show it all: facts, how they changed and a year of episodes.',
  )

export const seed: Scenario = {
  start: () =>
    fauxAssistantMessage(
      [fauxToolCall('seed_memory', {}), fauxToolCall('seed_episodes', {})],
      { stopReason: 'toolUse' },
    ),
  replies: { seed_memory: saved, seed_episodes: saved },
}
