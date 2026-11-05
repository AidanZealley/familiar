import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import {
  configure,
  createRegistry,
  Harness,
  type ToolExecutionApi,
} from '@earendil-works/pi-durable'
import { expect, test, vi } from 'vitest'
import { harnessOptions } from './harness.ts'
import type { Author } from './conversation/message.ts'
import { definePlugin, type FamiliarPlugin } from './index.ts'
import {
  defineDoc,
  defineExtension,
  defineTask,
  GenerationTask,
  hook,
  section,
  ToolTask,
  wrapSection,
  wrapTool,
} from './extensions.ts'
import { ReopenableStorage, testHost } from './testing.ts'
import { defineTool, Type } from './tools.ts'

// Tools and extensions as plugins use them. Who a tool call runs for: a
// message's author, through nesting, queued messages and restarts; a
// scheduled run's creator is checked in schedules/task.test.ts.

const first = { id: 'person-1', name: 'Sam' }
const second = { id: 'person-2', name: 'Sam' }
async function setup(plugin: FamiliarPlugin) {
  const host = await testHost({ plugins: [plugin] })
  return { faux: host.faux, familiar: host.familiar, reopen: host.reopen }
}

const call = (name: string) =>
  fauxAssistantMessage(fauxToolCall(name, {}), { stopReason: 'toolUse' })

const output = { output: [{ type: 'text' as const, text: 'Done' }] }

test('tools and nested calls retain their author across rounds while another author is queued', async () => {
  const seen: (Author | undefined)[] = []
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const { faux, familiar: current } = await setup({
    name: 'identity',
    title: 'Identity',
    extension: () => ({
      tools: [
        defineTool({
          name: 'outer',
          description: 'Test nested calls',
          parameters: Type.Object({}),
          execute: async (_args, api, context) => {
            seen.push(api.author)
            await held
            await api.executeTool('inner', {}, context)
            return output
          },
        }),
        defineTool({
          name: 'inner',
          description: 'Report attribution',
          parameters: Type.Object({}),
          execute: async (_args, api) => {
            seen.push(api.author)
            return output
          },
        }),
      ],
    }),
  })
  const familiar = current()
  faux.setResponses([
    call('outer'),
    call('inner'),
    fauxAssistantMessage('First done'),
    call('inner'),
    fauxAssistantMessage('Second done'),
  ])
  await familiar.send({ author: first, text: 'First', requestId: 'first' })
  await vi.waitFor(() => expect(seen).toEqual([first]))
  await familiar.send({ author: second, text: 'Second', requestId: 'second' })
  const queued = await familiar.watch()
  await queued.stop()
  expect(JSON.stringify(queued.value.docs['pi.inbox'])).toContain('person-2')
  release()
  await familiar.idle()
  expect(seen).toEqual([first, first, first, second])
})

test('a replay-safe interrupted tool resolves the same author after reopening', async () => {
  const seen: (Author | undefined)[] = []
  let interrupted = false
  const {
    faux,
    familiar: current,
    reopen,
  } = await setup({
    name: 'identity',
    title: 'Identity',
    extension: () => ({
      tools: [
        defineTool({
          name: 'identify',
          description: 'Report attribution',
          parameters: Type.Object({}),
          replay: 'safe',
          execute: async (_args, api, context) => {
            seen.push(api.author)
            if (!interrupted) {
              const signal = context.abortSignal!
              await new Promise<void>((_resolve, reject) => {
                signal.addEventListener(
                  'abort',
                  () => {
                    interrupted = true
                    reject(signal.reason)
                  },
                  { once: true },
                )
              })
            }
            return output
          },
        }),
      ],
    }),
  })
  const familiar = current()
  faux.setResponses([call('identify')])
  await familiar.send({ author: first, text: 'First', requestId: 'first' })
  await vi.waitFor(() => expect(seen).toEqual([first]))
  await familiar.send({ author: second, text: 'Second', requestId: 'second' })
  // Familiar stops mid-call; the next process finishes both runs.
  const reopened = await reopen({}, async () =>
    faux.setResponses([
      fauxAssistantMessage('Recovered'),
      call('identify'),
      fauxAssistantMessage('Second done'),
    ]),
  )
  await reopened.idle()
  expect(seen).toEqual([first, first, second])
})

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

test('the author reaches the tool through live API getters', async () => {
  const first = createModels()
  const second = createModels()
  let current = first
  // Only author lookup (no such task) and the live getter are exercised.
  const api = {
    taskId: 1,
    commit: async (change: (tx: unknown) => unknown) =>
      change({ task: async () => undefined }),
    get models() {
      return current
    },
  } as unknown as ToolExecutionApi
  const tool = defineTool({
    name: 'live_models',
    description: 'Check the current models during a call.',
    parameters: Type.Object({}),
    execute: async (_args, invocation) => {
      expect(invocation.author).toBeUndefined()
      expect(invocation.models).toBe(first)
      current = second
      expect(invocation.models).toBe(second)
      return { output: [] }
    },
  })

  expect(await tool.execute({}, api, BACKGROUND_CONTEXT)).toEqual({
    output: [],
  })
})

test('a tool keeps its last reported details unless its result replaces them, after a restart too', async () => {
  const { faux, familiar, reopen } = await setup({
    name: 'example',
    title: 'Example',
    extension: () => ({
      tools: [
        defineTool({
          name: 'lookup',
          description: 'Look up a value.',
          parameters: Type.Object({ value: Type.String() }),
          execute: async ({ value }, api, context) => {
            await api.details({ source: value }, context)
            return output
          },
        }),
        defineTool({
          name: 'override',
          description: 'Return final details.',
          parameters: Type.Object({}),
          execute: async (_args, api, context) => {
            await api.details({ stale: true }, context)
            return { ...output, details: { final: true } }
          },
        }),
      ],
    }),
  })
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall('lookup', { value: 'answer' }),
        fauxToolCall('override', {}),
      ],
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Done.'),
  ])
  await familiar().send({ author: first, text: 'Go', requestId: 'go' })
  await familiar().idle()

  const watch = await (await reopen()).watch()
  await watch.stop()
  const details = watch.value.entries
    .filter((entry) => entry.kind === 'pi.tool-result')
    .map((entry) => (entry.model?.[0] as { details?: unknown }).details)
  expect(details).toEqual([{ source: 'answer' }, { final: true }])
})

test('Stop aborts a running tool', async () => {
  let started!: (signal: AbortSignal) => void
  const running = new Promise<AbortSignal>((resolve) => {
    started = resolve
  })
  const { faux, familiar } = await setup({
    name: 'test',
    title: 'Test',
    extension: () => ({
      tools: [
        defineTool({
          name: 'wait',
          description: 'Wait for cancellation.',
          parameters: Type.Object({}),
          execute: async (_args, _api, context) => {
            const signal = context.abortSignal!
            started(signal)
            await new Promise((resolve) =>
              signal.addEventListener('abort', resolve, { once: true }),
            )
            signal.throwIfAborted()
            return output
          },
        }),
      ],
    }),
  })
  faux.setResponses([call('wait')])
  await familiar().send({ author: first, text: 'Go', requestId: 'go' })
  const signal = await running
  await familiar().abort()
  await familiar().idle()
  expect(signal.aborted).toBe(true)
})

test('extensions run through Familiar with their sections, hooks, wrappers, tasks and transactional nested calls', async () => {
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
  const { faux, familiar: current } = await testHost({
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
  const familiar = current()
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('increment', { amount: '2' }), {
      stopReason: 'toolUse',
    }),
    (context) => {
      expect(JSON.stringify(context.messages)).toContain('Committed 12')
      return fauxAssistantMessage('Done.')
    },
  ])
  await familiar.send({
    author: { id: 'test', name: 'test' },
    text: 'Go',
    requestId: 'full',
  })
  await familiar.idle()
  expect(events).toEqual(['request', 'tool', 'wrapper', 'nested', 'request'])
  const watch = await familiar.watch()
  await watch.stop()
  const result = watch.value.entries.find(
    (entry) => entry.kind === 'pi.tool-result',
  )?.model?.[0]
  expect(result).toMatchObject({
    isError: false,
    content: [{ type: 'text', text: 'Committed 12' }],
    details: { value: 12 },
  })
})
