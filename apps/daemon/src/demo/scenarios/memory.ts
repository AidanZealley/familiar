import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@familiar-ai/core/models/faux'
import type { FamiliarId, Workspace } from '@familiar-ai/core'
import { OWNER_ID } from '../../serve.ts'
import { SEED_MESSAGE, seedPinned } from './seed.ts'
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

export async function seedDemo(workspace: Workspace, id: FamiliarId) {
  // Start with a year of sample memory, so the Memory pages have something to
  // show, asked for in the owner's DM. Pinning goes through the owner's API,
  // which rebalances core.
  const familiar = workspace.familiars.get(id)!
  const dm = (await workspace.rooms.get(
    await workspace.rooms.dm(id, OWNER_ID),
  ))!
  await dm.replyTo(
    await dm.post({
      author: { id: OWNER_ID, name: 'demo' },
      text: SEED_MESSAGE,
      requestId: 'seed',
    }),
  )
  const watch = await familiar.memory.watch()
  await watch.stop()
  for (const text of seedPinned) {
    const fact = watch.value?.facts.find((fact) => fact.text === text)
    if (fact) {
      await familiar.memory.setPinned(fact.id, true)
    }
  }
}
