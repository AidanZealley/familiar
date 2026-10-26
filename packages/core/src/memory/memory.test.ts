import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import type { TranscriptContext } from '@earendil-works/pi-ai'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  createRegistry,
  defineDoc,
  Harness,
  MemoryStorage,
} from '@earendil-works/pi-durable'
import { CORE_BUDGET, coreFacts, listFacts } from './facts.ts'
import { afterEach, expect, test } from 'vitest'
import {
  summonFamiliar,
  type Familiar,
  type FamiliarOptions,
} from '../familiar.ts'

type SetupOptions = Partial<Omit<FamiliarOptions, 'models' | 'model'>> & {
  contextWindow?: number
}

// A scripted model: each test lists what it replies, so Familiar runs for real
// (storage, tools, prompt) with no network.
async function setup({ contextWindow, ...options }: SetupOptions = {}) {
  const faux = fauxProvider({ models: [{ id: 'faux-1', contextWindow }] })
  const models = createModels()
  models.setProvider(faux.provider)
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    ...options,
  })
  opened.push(familiar)

  const say = async (text: string) => {
    await familiar.send({ author: 'aidan', text, requestId: text })
    await familiar.idle()
  }
  const memory = async () => {
    const watch = await familiar.memory.watch()
    await watch.stop()
    return watch.value
  }
  return { faux, familiar, say, memory }
}

const opened: Familiar[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((familiar) => familiar.dismiss()))
})

/** The system prompt sections of one request. */
const sectionsOf = (context: TranscriptContext) =>
  context.messages.flatMap((message) =>
    message.role === 'system' ? [message.sections ?? {}] : [],
  )

test('the model remembers a fact and sees it on the next request', async () => {
  const { faux, say, memory } = await setup()
  let prompt: Record<string, string | null>[] = []
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('remember', { text: 'Uses pnpm', importance: 3 }),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Noted.'),
    (context) => {
      prompt = sectionsOf(context)
      return fauxAssistantMessage('pnpm, as always.')
    },
  ])

  await say('I always use pnpm.')
  expect((await memory())?.facts).toMatchObject([
    { id: 'm1', text: 'Uses pnpm', importance: 3, core: true },
  ])

  await say('Which package manager?')
  const latest = prompt.findLast((sections) => sections.memory)
  expect(latest?.memory).toContain('m1: Uses pnpm')
})

test('people can revise, retire, pin and forget facts', async () => {
  const { faux, familiar, say, memory } = await setup()
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall('remember', { text: 'Lives in Leeds', importance: 4 }),
        fauxToolCall('remember', { text: 'Has a cat', importance: 3 }),
        fauxToolCall('remember', { text: 'Likes blue pens', importance: 1 }),
        fauxToolCall('remember', { text: 'Typo', importance: 2 }),
      ],
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Noted.'),
  ])
  await say('About me.')

  await familiar.memory.revise('m1', 'Lives in York')
  await familiar.memory.retire('m2')
  await familiar.memory.setCore('m3', true)
  await familiar.memory.forget('m4')
  expect((await memory())?.facts).toMatchObject([
    { id: 'm1', until: expect.any(Number) },
    { id: 'm2', until: expect.any(Number) },
    { id: 'm3', core: true },
    { id: 'm5', text: 'Lives in York', replaces: 'm1', core: true },
  ])
  await expect(familiar.memory.revise('m1', 'Again')).rejects.toThrow(
    'already past',
  )
})

/** The text of every tool result sent back in one request. */
const toolResultsOf = (context: TranscriptContext) =>
  context.messages.flatMap((message) =>
    message.role === 'toolResult'
      ? [
          message.content
            .map((part) => ('text' in part ? part.text : ''))
            .join(''),
        ]
      : [],
  )

test('a fact that does not exist is an error for the model, not a crash', async () => {
  const { faux, say, memory } = await setup()
  let results: string[] = []
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('retire', { id: 'm9' }), {
      stopReason: 'toolUse',
    }),
    (context) => {
      results = toolResultsOf(context)
      return fauxAssistantMessage('Nothing to retire.')
    },
  ])
  await say('Retire m9.')
  expect(results.join()).toContain('No fact m9')
  expect((await memory())?.facts).toEqual([])
})

/** One reply that saves `count` important facts of about 100 characters each. */
const rememberMany = (count: number) =>
  fauxAssistantMessage(
    Array.from({ length: count }, (_, index) =>
      fauxToolCall('remember', {
        text: `Fact ${index}: ${'something worth keeping '.repeat(4)}`,
        importance: 4,
      }),
    ),
    { stopReason: 'toolUse' },
  )

test('beyond core budget, remember keeps facts outside the prompt instead of refusing', async () => {
  const { faux, say, memory } = await setup()
  let results: string[] = []
  let prompt: Record<string, string | null>[] = []
  faux.setResponses([
    rememberMany(70),
    (context) => {
      results = toolResultsOf(context)
      return fauxAssistantMessage('Noted.')
    },
    (context) => {
      prompt = sectionsOf(context)
      return fauxAssistantMessage('Hello.')
    },
  ])
  await say('Here is far too much about me.')
  const state = (await memory())!
  expect(state.facts).toHaveLength(70)
  expect(results.filter((result) => result.includes('outside'))).not.toEqual([])
  const core = coreFacts(state)
  expect(core.length).toBeLessThan(70)
  expect(listFacts(core).length).toBeLessThanOrEqual(CORE_BUDGET)

  await say('Hi.')
  const shown = prompt.findLast((sections) => sections.memory)?.memory ?? ''
  expect(shown).toContain(listFacts(core))
  expect(shown).not.toContain(state.facts.at(-1)!.text)
})

test('past facts never appear in the prompt', async () => {
  const { faux, say } = await setup()
  let prompt: Record<string, string | null>[] = []
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall('remember', { text: 'Lives in Leeds', importance: 4 }),
        fauxToolCall('remember', { text: 'Works at Northbank', importance: 4 }),
      ],
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Noted.'),
    fauxAssistantMessage(
      [
        fauxToolCall('revise_memory', { id: 'm1', text: 'Lives in York' }),
        fauxToolCall('retire', { id: 'm2' }),
      ],
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Updated.'),
    (context) => {
      prompt = sectionsOf(context)
      return fauxAssistantMessage('York.')
    },
  ])
  await say('I live in Leeds and work at Northbank.')
  await say('I moved to York and left Northbank.')
  await say('Where do I live?')
  const shown = prompt.findLast((sections) => sections.memory)?.memory
  expect(shown).toContain('m3: Lives in York')
  expect(shown).not.toContain('Leeds')
  expect(shown).not.toContain('Northbank')
})

test('memory saved by version 1 opens with every fact in core', async () => {
  const MemoryV1 = defineDoc<{
    facts: { id: string; text: string; at: number }[]
    next: number
  }>({
    kind: 'familiar.memory',
    version: 1,
    scope: 'session',
    initial: () => ({ facts: [], next: 1 }),
    checkpointWhen: () => true,
  })
  const storage = new MemoryStorage()
  // The old Harness closes without closing the storage the new one opens.
  const kept = new Proxy(storage, {
    get: (target, key) =>
      key === 'close' ? async () => {} : Reflect.get(target, key, target),
  })
  const old = await Harness.open(
    kept,
    { models: createModels(), registry: createRegistry() },
    BACKGROUND_CONTEXT,
  )
  await old.commit(async (tx) => {
    const memory = await tx.doc(MemoryV1)
    memory.facts.push({ id: 'm1', text: 'Uses pnpm', at: 10 })
    memory.next = 2
  }, BACKGROUND_CONTEXT)
  await old.close(BACKGROUND_CONTEXT)

  const { memory } = await setup({ storage })
  expect(await memory()).toEqual({
    facts: [
      {
        id: 'm1',
        text: 'Uses pnpm',
        at: 10,
        created: 10,
        importance: 3,
        core: true,
      },
    ],
    next: 2,
  })
})
