import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { configure, createRegistry, Harness } from '@earendil-works/pi-durable'
import { harnessOptions } from '../context/index.ts'
import { transcriptExchanges } from '../memory/exchanges.ts'
import { newMessages } from '../memory/upkeep/transcript.ts'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { afterEach, expect, test, vi } from 'vitest'
import { defineTool, Type, type Author } from '../index.ts'
import {
  summonFamiliar,
  type Familiar,
  type FamiliarPlugin,
} from '../familiar.ts'
import { ReopenableStorage, withHarness } from '../memory/testing.ts'
import { MESSAGE_KIND } from './message.ts'

const first = { id: 'person-1', name: 'Sam' }
const second = { id: 'person-2', name: 'Sam' }
const opened: Familiar[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((familiar) => familiar.dismiss()))
})

async function setup(plugin?: FamiliarPlugin) {
  const storage = new ReopenableStorage()
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const open = async () => {
    const familiar = await summonFamiliar({
      storage,
      models,
      model: { provider: 'faux', modelId: 'faux-1' },
      timeZone: 'UTC',
      plugins: plugin ? [plugin] : [],
    })
    opened.push(familiar)
    return familiar
  }
  return { faux, open }
}

const call = (name: string) =>
  fauxAssistantMessage(fauxToolCall(name, {}), { stopReason: 'toolUse' })

const output = { output: [{ type: 'text' as const, text: 'Done' }] }

test('same-name authors stay distinct and rename snapshots survive retries and reopen', async () => {
  const { faux, open } = await setup()
  const familiar = await open()
  faux.setResponses(
    Array.from({ length: 3 }, () => fauxAssistantMessage('Hello')),
  )
  const author = { ...first }
  await familiar.send({ author, text: 'One', requestId: 'one' })
  author.name = 'Samuel'
  await familiar.idle()
  await familiar.send({ author: second, text: 'Two', requestId: 'two' })
  await familiar.idle()
  await familiar.send({ author, text: 'Three', requestId: 'three' })
  await familiar.idle()
  await familiar.send({ author, text: 'Changed retry', requestId: 'one' })
  await familiar.dismiss()
  const reopened = await open()
  const watch = await reopened.watch()
  await watch.stop()
  const entries = watch.value.entries.filter(
    (entry) => entry.kind === MESSAGE_KIND,
  )
  expect(entries.map((entry) => entry.data)).toEqual([
    { author: first, text: 'One' },
    { author: second, text: 'Two' },
    { author, text: 'Three' },
  ])
  expect(entries.map((entry) => entry.model?.[0].content)).toEqual([
    '[Message from {"id":"person-1","name":"Sam"}]\nOne',
    '[Message from {"id":"person-2","name":"Sam"}]\nTwo',
    '[Message from {"id":"person-1","name":"Samuel"}]\nThree',
  ])
  for (const invalid of [
    'Sam',
    { name: 'Sam' },
    { id: '', name: 'Sam' },
    { id: 'sam', name: '' },
  ]) {
    await expect(
      reopened.send({
        author: invalid as Author,
        text: 'No',
        requestId: 'invalid',
      }),
    ).rejects.toThrow('An author requires a non-empty id and name')
  }
})

test('tools and nested calls retain their author across rounds while another author is queued', async () => {
  const seen: (Author | undefined)[] = []
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const { faux, open } = await setup({
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
  const familiar = await open()
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
  const { faux, open } = await setup({
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
  const familiar = await open()
  faux.setResponses([call('identify')])
  await familiar.send({ author: first, text: 'First', requestId: 'first' })
  await vi.waitFor(() => expect(seen).toEqual([first]))
  await familiar.send({ author: second, text: 'Second', requestId: 'second' })
  await familiar.dismiss()
  faux.setResponses([
    fauxAssistantMessage('Recovered'),
    call('identify'),
    fauxAssistantMessage('Second done'),
  ])
  const reopened = await open()
  await reopened.idle()
  expect(seen).toEqual([first, first, second])
})

test('name-only history survives reopening, memory reads and tool execution without an inferred ID', async () => {
  const context = BACKGROUND_CONTEXT
  const storage = new ReopenableStorage()
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const model = { provider: 'faux', modelId: 'faux-1' }
  const registry = createRegistry()
  const seen: (Author | undefined)[] = []
  registry.install({
    name: 'identity',
    tools: [
      defineTool({
        name: 'identify',
        description: 'Report attribution',
        parameters: Type.Object({}),
        execute: async (_args, api) => {
          seen.push(api.author)
          return output
        },
      }),
    ],
  })
  const harness = await Harness.open(
    storage,
    harnessOptions({ models, model }, registry, 64_000),
    context,
  )
  try {
    const conversation = await harness.root(context)
    await conversation.commit(
      (tx) => configure(tx, conversation.id, { model }),
      context,
    )
    faux.setResponses([call('identify'), fauxAssistantMessage('Noted')])
    // Reproduce the persisted entry and generation produced by the old API.
    await conversation.submit(
      {
        type: 'input',
        content: '[Message from "Sam"]\nMy bicycle is blue.',
        entry: {
          kind: MESSAGE_KIND,
          data: { author: 'Sam', text: 'My bicycle is blue.' },
        },
      },
      context,
    )
    await conversation.waitForIdle(context)
    expect(seen).toEqual([undefined])
  } finally {
    await harness.close(context)
  }
  const familiar = await summonFamiliar({
    storage,
    models,
    model,
    timeZone: 'UTC',
  })
  opened.push(familiar)
  faux.setResponses([
    (request) => {
      expect(JSON.stringify(request.messages)).toContain('My bicycle is blue.')
      return fauxAssistantMessage('Hello')
    },
  ])
  await familiar.send({ author: first, text: 'Hello again', requestId: 'new' })
  await familiar.idle()
  const watch = await familiar.watch()
  await watch.stop()
  expect(
    watch.value.entries
      .filter((entry) => entry.kind === MESSAGE_KIND)
      .map((entry) => entry.data),
  ).toEqual([
    { author: 'Sam', text: 'My bicycle is blue.' },
    { author: first, text: 'Hello again' },
  ])
  await familiar.dismiss()
  await withHarness(storage, (reader) =>
    reader.commit(async (tx) => {
      const batch = await newMessages(tx, null, 10_000, 'Familiar', 'UTC')
      expect(batch?.transcript).toContain('"Sam": My bicycle is blue.')
      expect(batch?.transcript).toContain('"id":"person-1"')
      const exchanges = await transcriptExchanges('UTC').catchUp(tx)
      expect(exchanges.search('bicycle', Date.now())[0]).toMatchObject({
        author: 'Sam',
        text: expect.stringContaining('My bicycle is blue.'),
      })
    }, context),
  )
})
