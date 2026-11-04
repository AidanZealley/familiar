import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { configure, createRegistry, Harness } from '@earendil-works/pi-durable'
import { expect, test } from 'vitest'
import { harnessOptions } from '../harness.ts'
import type { Author } from '../conversation/message.ts'
import { ReopenableStorage } from '../memory/testing.ts'
import { defineTool, Type } from './tools.ts'

// People, schedules, nesting, recovery and name-only history are resolved end
// to end in conversation/authors.test.ts and schedules/schedules.test.ts.
// Upkeep runs only Familiar's own memory tools, so its kind of input, plain
// text with no message entry, is checked here.
test('input with no person behind it, such as an upkeep pass, has no author', async () => {
  const context = BACKGROUND_CONTEXT
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const model = { provider: 'faux', modelId: 'faux-1' }
  const seen: (Author | undefined)[] = []
  const registry = createRegistry()
  registry.install({
    name: 'identity',
    tools: [
      defineTool({
        name: 'identify',
        description: 'Report attribution',
        parameters: Type.Object({}),
        execute: async (_args, api) => {
          seen.push(api.author)
          return { output: [] }
        },
      }),
    ],
  })
  const harness = await Harness.open(
    new ReopenableStorage(),
    harnessOptions({ models, model, chatModels: [] }, registry, 64_000),
    context,
  )
  try {
    const conversation = await harness.root(context)
    await conversation.commit(
      (tx) => configure(tx, conversation.id, { model }),
      context,
    )
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('identify', {}), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('Done'),
    ])
    // How upkeep submits each pass.
    await conversation.submit(
      { type: 'input', content: 'File the day.', requestId: 'pass' },
      context,
    )
    await conversation.waitForIdle(context)
  } finally {
    await harness.close(context)
  }
  expect(seen).toEqual([undefined])
})
