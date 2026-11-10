import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { configure, createRegistry, Harness } from '@earendil-works/pi-durable'
import { expect, test, vi } from 'vitest'
import { harnessOptions } from './workspace/harness.ts'
import type { Author } from './conversation/message.ts'
import type { FamiliarPlugin } from './index.ts'
import { ReopenableStorage, replyTo, testHost } from './testing.ts'
import { createPlugins } from './plugins/index.ts'
import { defineTool, familiar as services, Type } from './tools.ts'

// Tools as plugins use them. Who a tool call runs for: a
// message's author, through nesting, queued messages and restarts; a
// scheduled run's creator is checked in schedules/task.test.ts.

const first = { id: 'person-1', name: 'Sam' }
const second = { id: 'person-2', name: 'Sam' }
async function setup(plugin: FamiliarPlugin) {
  const host = await testHost({ plugins: [plugin] })
  return {
    faux: host.faux,
    familiar: host.familiar,
    dm: host.dm,
    send: host.send,
    reopen: host.reopen,
  }
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
  const {
    faux,
    familiar: current,
    dm,
  } = await setup({
    name: 'identity',
    title: 'Identity',
    tools: [
      defineTool({
        name: 'outer',
        description: 'Test nested calls',
        parameters: Type.Object({}),
        execute: async (_args, api, context) => {
          seen.push(await services(context).author())
          await held
          await api.executeTool('inner', {}, context)
          return output
        },
      }),
      defineTool({
        name: 'inner',
        description: 'Report attribution',
        parameters: Type.Object({}),
        execute: async (_args, _api, context) => {
          seen.push(await services(context).author())
          return output
        },
      }),
    ],
  })
  const familiar = current()
  faux.setResponses([
    call('outer'),
    call('inner'),
    fauxAssistantMessage('First done'),
    call('inner'),
    fauxAssistantMessage('Second done'),
  ])
  const one = await dm().post({
    author: first,
    text: 'First',
    requestId: 'first',
  })
  await vi.waitFor(() => expect(seen).toEqual([first]))
  const two = await dm().post({
    author: second,
    text: 'Second',
    requestId: 'second',
  })
  await vi.waitFor(async () => {
    const queued = await familiar.watch()
    await queued.stop()
    expect(JSON.stringify(queued.value.docs['pi.inbox'])).toContain('person-2')
  })
  release()
  await replyTo(dm(), one)
  await replyTo(dm(), two)
  expect(seen).toEqual([first, first, first, second])
})

test('a replay-safe interrupted tool resolves the same author after reopening', async () => {
  const seen: (Author | undefined)[] = []
  let interrupted = false
  const { faux, dm, reopen } = await setup({
    name: 'identity',
    title: 'Identity',
    tools: [
      defineTool({
        name: 'identify',
        description: 'Report attribution',
        parameters: Type.Object({}),
        replay: 'safe',
        execute: async (_args, _api, context) => {
          seen.push(await services(context).author())
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
  })
  faux.setResponses([call('identify')])
  const one = await dm().post({
    author: first,
    text: 'First',
    requestId: 'first',
  })
  await vi.waitFor(() => expect(seen).toEqual([first]))
  const two = await dm().post({
    author: second,
    text: 'Second',
    requestId: 'second',
  })
  // Familiar stops mid-call; the next process finishes both runs.
  const reopened = await reopen({}, async () =>
    faux.setResponses([
      fauxAssistantMessage('Recovered'),
      call('identify'),
      fauxAssistantMessage('Second done'),
    ]),
  )
  await replyTo(reopened.dm, one)
  await replyTo(reopened.dm, two)
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
  // As Familiar installs a plugin's tools.
  const [identity] = createPlugins({
    plugins: [
      {
        name: 'identity',
        title: 'Identity',
        tools: [
          defineTool({
            name: 'identify',
            description: 'Report attribution',
            parameters: Type.Object({}),
            execute: async (_args, _api, context) => {
              seen.push(await services(context).author())
              return { output: [] }
            },
          }),
        ],
      },
    ],
    timeZone: 'UTC',
  }).extensions
  registry.install(identity)
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

test('a tool keeps its last reported details unless its result replaces them, after a restart too', async () => {
  const { faux, send, reopen } = await setup({
    name: 'example',
    title: 'Example',
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
  await send({ author: first, text: 'Go', requestId: 'go' })

  const watch = await (await reopen()).familiar.watch()
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
  const { faux, dm } = await setup({
    name: 'test',
    title: 'Test',
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
  })
  faux.setResponses([call('wait')])
  await dm().post({ author: first, text: 'Go', requestId: 'go' })
  const signal = await running
  await dm().stop()
  await expect.poll(() => signal.aborted).toBe(true)
})
