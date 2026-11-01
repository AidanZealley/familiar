/// <reference lib="dom" />
import { expect, test } from 'vitest'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { MemoryStorage } from '@earendil-works/pi-durable'
import {
  definePlugin,
  defineTool,
  Type,
  summonFamiliar,
  type ToolContext,
} from '@familiar-ai/core'
import { createHttpApi } from '@familiar-ai/core/http'
import { createFamiliarStore } from '../../../packages/client/src/store.ts'
import { toTranscript } from '../../../packages/client/src/transcript.ts'

class ReopenableStorage extends MemoryStorage {
  override async close() {}
}

test('plugin results and last reported details survive reopen and reach the transcript', async () => {
  const storage = new ReopenableStorage()
  const faux = fauxProvider({ models: [{ id: 'test' }] })
  const models = createModels()
  models.setProvider(faux.provider)
  const plugin = definePlugin({
    name: 'example',
    title: 'Example',
    extension: () => ({
      tools: [
        defineTool({
          name: 'lookup',
          description: 'Look up a value.',
          parameters: Type.Object({ value: Type.String() }),
          structuredOutputSchema: Type.Object({ value: Type.String() }),
          replay: 'safe',
          execute: async ({ value }, context) => {
            expect(Object.keys(context).sort()).toEqual([
              'abortSignal',
              'details',
              'now',
              'output',
            ])
            context.output('Text fallback')
            await context.details({ source: value })
            return { structuredOutput: { value } }
          },
        }),
        defineTool({
          name: 'override',
          description: 'Return final details.',
          parameters: Type.Object({}),
          execute: async (_, context) => {
            await context.details({ stale: true })
            return {
              output: [{ type: 'text', text: 'Final text' }],
              details: { final: true },
            }
          },
        }),
      ],
    }),
  })
  const options = {
    storage,
    models,
    model: { provider: 'faux', modelId: 'test' },
    timeZone: 'UTC',
    plugins: [plugin],
  }
  let familiar = await summonFamiliar(options)
  try {
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall('lookup', { value: 'answer' }),
          fauxToolCall('override', {}),
        ],
        { stopReason: 'toolUse' },
      ),
      (context) => {
        const results = context.messages.filter(
          (message) => message.role === 'toolResult',
        )
        expect(results.map((result) => result.details)).toEqual([
          { source: 'answer' },
          { final: true },
        ])
        return fauxAssistantMessage('Done.')
      },
    ])
    await familiar.send({ author: 'test', text: 'Go', requestId: 'go' })
    await familiar.idle()
    await familiar.dismiss()
    familiar = await summonFamiliar(options)
    const watch = await familiar.watch()
    await watch.stop()
    // JSON roundtrip mirrors persisted results sent through the HTTP view.
    const api = createHttpApi(familiar, { authenticate: () => 'test' })
    const client = createFamiliarStore('http://familiar.test', {
      fetch: async (input, init) => api.fetch(new Request(input, init)),
    })
    try {
      await expect.poll(() => client.getState().connection).toBe('open')
      const view = client.getState().view
      expect(view).toEqual(watch.value)
    } finally {
      client.getState().disconnect()
    }
    const transcript = toTranscript(JSON.parse(JSON.stringify(watch.value)))
    const calls = transcript.items.flatMap((item) =>
      item.type === 'reply' ? item.toolCalls : [],
    )
    expect(calls).toMatchObject([
      {
        name: 'lookup',
        status: 'done',
        output: 'Text fallback',
        details: { source: 'answer' },
      },
      {
        name: 'override',
        status: 'done',
        output: 'Final text',
        details: { final: true },
      },
    ])
  } finally {
    await familiar.dismiss()
  }
})

test('the adapter forwards cancellation', async () => {
  const faux = fauxProvider({ models: [{ id: 'test' }] })
  const models = createModels()
  models.setProvider(faux.provider)
  let markStarted: (context: ToolContext) => void = () => {}
  const started = new Promise<ToolContext>((resolve) => {
    markStarted = resolve
  })
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models,
    model: { provider: 'faux', modelId: 'test' },
    timeZone: 'UTC',
    plugins: [
      definePlugin({
        name: 'test',
        title: 'Test',
        extension: () => ({
          tools: [
            defineTool({
              name: 'wait',
              description: 'Wait for cancellation.',
              parameters: Type.Object({}),
              execute: async (_, context) => {
                markStarted(context)
                await new Promise<void>((resolve) =>
                  context.abortSignal?.addEventListener(
                    'abort',
                    () => resolve(),
                    { once: true },
                  ),
                )
                context.abortSignal?.throwIfAborted()
                throw new Error('Expected cancellation')
              },
            }),
          ],
        }),
      }),
    ],
  })
  try {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('wait', {}), { stopReason: 'toolUse' }),
    ])
    await familiar.send({ author: 'test', text: 'Go', requestId: 'go' })
    const context = await started
    await familiar.abort()
    await familiar.idle()
    expect(context.abortSignal?.aborted).toBe(true)
  } finally {
    await familiar.dismiss()
  }
})

test('demo sample memory is prepared before Familiar opens', async () => {
  const { prepareDemoMemory } = await import('./demo/seed.ts')
  const storage = new ReopenableStorage()
  await prepareDemoMemory(storage, Date.UTC(2026, 10, 1))
  const faux = fauxProvider({ models: [{ id: 'test' }] })
  const models = createModels()
  models.setProvider(faux.provider)
  const familiar = await summonFamiliar({
    storage,
    models,
    model: { provider: 'faux', modelId: 'test' },
    timeZone: 'UTC',
  })
  try {
    const memory = await familiar.memory.watch()
    await memory.stop()
    expect(memory.value?.facts.length).toBeGreaterThan(20)
    const episodes = await familiar.memory.watchEpisodes()
    await episodes.stop()
    expect(episodes.value?.episodes.length).toBeGreaterThan(10)
  } finally {
    await familiar.dismiss()
  }
})
