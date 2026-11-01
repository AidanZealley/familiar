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
import {
  defineDoc,
  defineTask,
  defineExtension,
  section,
  hook,
  wrapTool,
  wrapSection,
  ToolTask,
  GenerationTask,
} from '@familiar-ai/core/extensions'
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
          execute: async ({ value }, api, context) => {
            api.output('Text fallback')
            await api.details({ source: value }, context)
            return { structuredOutput: { value } }
          },
        }),
        defineTool({
          name: 'override',
          description: 'Return final details.',
          parameters: Type.Object({}),
          execute: async (_, api, context) => {
            await api.details({ stale: true }, context)
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

test('tool execution retains cancellation', async () => {
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
              execute: async (_, _api, context) => {
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

test('Familiar imports retain sections, hooks, wrappers, tasks and transactional nested execution', async () => {
  const Counter = defineDoc({
    kind: 'plugin.counter',
    version: 1,
    scope: 'session',
    initial: () => ({ value: 0 }),
    checkpointWhen: () => true,
  })
  const Increment = defineTask<{ amount: number }, { phase: 'run' }, number>({
    name: 'plugin.increment',
    version: 1,
    initial: () => ({ phase: 'run' }),
    phases: {
      run: (task, runtime, context) =>
        runtime.commit(async (tx) => {
          const state = await tx.doc(Counter)
          state.value += task.input.amount
          return {
            status: 'terminal',
            outcome: { status: 'completed', result: state.value },
          }
        }, context),
    },
    abort: (_task, runtime, context) =>
      runtime.commit(
        () => ({ status: 'terminal', outcome: { status: 'aborted' } }),
        context,
      ),
  })
  const events: string[] = []
  const read = defineTool({
    name: 'read_counter',
    description: 'Read the plugin counter.',
    parameters: Type.Object({}),
    callers: ['tools'],
    structuredOutputSchema: Type.Object({ value: Type.Number() }),
    execute: async (_args, api, context) => {
      const state = await api.snapshot(Counter, context)
      return { structuredOutput: { value: state?.value ?? 0 } }
    },
  })
  const increment = defineTool({
    name: 'increment',
    description: 'Increment and read back.',
    parameters: Type.Object({ amount: Type.Number() }),
    replay: 'safe',
    prepareArguments: (args) => ({
      amount: Number((args as { amount: unknown }).amount),
    }),
    execute: async ({ amount }, api, context) => {
      await api.commit(async (tx) => {
        ;(await tx.doc(Counter)).value = 10
      }, context)
      const task = await api.createTask(
        Increment,
        { amount },
        { ownership: { kind: 'task', taskId: api.taskId } },
        context,
      )
      const settled = await api.waitForTask(task, context)
      expect(settled.state.outcome).toEqual({ status: 'completed', result: 12 })
      await api.memo('saved', { amount }, context)
      expect(await api.memo('saved', context)).toEqual({ amount })
      const nested = await api.executeTool(read.name, {}, context, {
        key: 'read',
      })
      expect(nested.structuredOutput).toEqual({ value: 12 })
      return {
        output: [{ type: 'text', text: 'Committed 12' }],
        details: { value: 12 },
      }
    },
  })
  const faux = fauxProvider({ models: [{ id: 'test' }] })
  const models = createModels()
  models.setProvider(faux.provider)
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models,
    model: { provider: 'faux', modelId: 'test' },
    timeZone: 'UTC',
    plugins: [
      definePlugin({
        name: 'full',
        title: 'Full extension',
        extension: () =>
          defineExtension({
            name: 'replaced-by-familiar',
            tools: [read, increment],
            tasks: [Increment],
            sections: [section('plugin_test', () => 'Original section')],
            wraps: [
              wrapSection('plugin_test', (original) => ({
                ...original,
                render: () => 'Wrapped section',
              })),
              wrapTool(increment, (original) => ({
                ...original,
                execute: async (args, api, context) => {
                  events.push('wrapper')
                  return original.execute(args, api, context)
                },
              })),
            ],
            hooks: [
              hook(GenerationTask, {
                beforeRequest: (request) => {
                  expect(JSON.stringify(request.messages)).toContain(
                    'Wrapped section',
                  )
                  events.push('request')
                },
              }),
              hook(ToolTask, {
                beforeTool: (call) => {
                  events.push(call.parent ? 'nested' : 'tool')
                },
              }),
            ],
          }),
      }),
    ],
  })
  try {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('increment', { amount: '2' }), {
        stopReason: 'toolUse',
      }),
      (context) => {
        expect(JSON.stringify(context.messages)).toContain('Committed 12')
        return fauxAssistantMessage('Done.')
      },
    ])
    await familiar.send({ author: 'test', text: 'Go', requestId: 'full' })
    await familiar.idle()
    expect(events).toEqual(['request', 'tool', 'wrapper', 'nested', 'request'])
    const watch = await familiar.watch()
    await watch.stop()
    const calls = toTranscript(watch.value).items.flatMap((item) =>
      item.type === 'reply' ? item.toolCalls : [],
    )
    expect(calls).toMatchObject([
      {
        name: 'increment',
        status: 'done',
        output: 'Committed 12',
        details: { value: 12 },
      },
    ])
  } finally {
    await familiar.dismiss()
  }
})
