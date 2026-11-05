import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { configure, createRegistry, Harness } from '@earendil-works/pi-durable'
import { expect, test, vi } from 'vitest'
import { harnessOptions } from '../harness.ts'
import type { Author } from '../conversation/message.ts'
import { type FamiliarPlugin } from '../familiar.ts'
import { ReopenableStorage, testHost } from '../testing.ts'
import { defineTool, Type } from './tools.ts'

// Who a tool call runs for: a message's author, through nesting, queued
// messages and restarts; a scheduled run's creator is checked in
// schedules.test.ts.

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
