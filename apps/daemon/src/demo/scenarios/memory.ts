import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import type { Familiar } from '@familiar-ai/core'
import { SEED_MESSAGE, seedPinned } from '../seed.ts'
import type { Scenario } from '../types.ts'

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

export async function seedDemo(familiar: Familiar) {
  // Start with a year of sample memory, so the Memory pages have something to
  // show. Pinning goes through the owner's API, which rebalances core.
  await familiar.send({ author: 'demo', text: SEED_MESSAGE, requestId: 'seed' })
  await familiar.idle()
  const watch = await familiar.memory.watch()
  await watch.stop()
  for (const text of seedPinned) {
    const fact = watch.value?.facts.find((fact) => fact.text === text)
    if (fact) {
      await familiar.memory.setPinned(fact.id, true)
    }
  }
}
