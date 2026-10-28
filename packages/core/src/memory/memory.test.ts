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
  Harness,
  MemoryStorage,
} from '@earendil-works/pi-durable'
import {
  CORE_BUDGET,
  coreFacts,
  FactError,
  Facts,
  listFacts,
  rememberFact,
  openMemory,
  reviseFact,
} from './facts.ts'
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
  const { faux, familiar, say, memory } = await setup()
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
    { id: 'f1', text: 'Uses pnpm', importance: 3, core: true },
  ])

  await say('Which package manager?')
  const latest = prompt.findLast((sections) => sections.memory)
  expect(latest?.memory).toContain('f1: Uses pnpm')

  // Clients learn what was saved from the result's details, not its wording.
  const view = await familiar.watch()
  await view.stop()
  const result = view.value.entries.find(
    (entry) => entry.kind === 'pi.tool-result',
  )
  expect(result?.model?.[0]).toMatchObject({ details: { saved: 'f1' } })
})

test('people can revise, retire and pin facts', async () => {
  const { faux, familiar, say, memory } = await setup()
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall('remember', { text: 'Lives in Leeds', importance: 4 }),
        fauxToolCall('remember', { text: 'Has a cat', importance: 3 }),
        fauxToolCall('remember', { text: 'Likes blue pens', importance: 1 }),
      ],
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Noted.'),
  ])
  await say('About me.')

  await familiar.memory.revise('f1', 'Lives in York')
  await familiar.memory.retire('f2')
  await familiar.memory.setPinned('f3', true)
  expect((await memory())?.facts).toMatchObject([
    { id: 'f1', until: expect.any(String) },
    { id: 'f2', until: expect.any(String) },
    { id: 'f3', core: true, pinned: true },
    {
      id: 'f4',
      text: 'Lives in York',
      replaces: ['f1'],
      sources: [],
      core: true,
    },
  ])
  await expect(familiar.memory.revise('f1', 'Again')).rejects.toThrow(
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

test('an edit that fails partway through a commit changes nothing', async () => {
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: createModels(), registry: createRegistry() },
    BACKGROUND_CONTEXT,
  )
  try {
    await harness.commit(async (tx) => {
      rememberFact(
        await openMemory(tx),
        {
          text: 'Lives in Leeds',
          importance: 4,
          since: '2025-01-01',
          sources: [],
        },
        10,
      )
    }, BACKGROUND_CONTEXT)
    await expect(
      harness.commit(async (tx) => {
        const memory = await openMemory(tx)
        rememberFact(
          memory,
          {
            text: 'Has a cat',
            importance: 3,
            since: '2025-01-01',
            sources: [],
          },
          20,
        )
        reviseFact(memory, 'f9', { text: 'Missing', since: '2025-01-01' }, 20)
      }, BACKGROUND_CONTEXT),
    ).rejects.toThrow(FactError)
    const watch = (await harness.watchDoc(Facts, BACKGROUND_CONTEXT))!
    await watch.stop()
    expect(watch.value).toMatchObject({
      facts: [{ id: 'f1', text: 'Lives in Leeds' }],
      next: 2,
    })
  } finally {
    await harness.close(BACKGROUND_CONTEXT)
  }
})

test('a fact that does not exist is an error for the model, not a crash', async () => {
  const { faux, say, memory } = await setup()
  let results: string[] = []
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('retire', { id: 'f9' }), {
      stopReason: 'toolUse',
    }),
    (context) => {
      results = toolResultsOf(context)
      return fauxAssistantMessage('Nothing to retire.')
    },
  ])
  await say('Retire f9.')
  expect(results.join()).toContain('No fact f9')
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
        fauxToolCall('revise_memory', { id: 'f1', text: 'Lives in York' }),
        fauxToolCall('retire', { id: 'f2' }),
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
  expect(shown).toContain('f3: Lives in York')
  expect(shown).not.toContain('Leeds')
  expect(shown).not.toContain('Northbank')
})

/** The recalled-memory note in one request, if any. */
const recalledIn = (context: TranscriptContext) =>
  context.messages
    .flatMap((message) =>
      message.role === 'user' && typeof message.content === 'string'
        ? [message.content]
        : [],
    )
    .find((content) => content.startsWith('Recalled from memory'))

test('a relevant fact outside core reaches the model, and the prompt stays the same', async () => {
  const { faux, say, memory } = await setup()
  const seen: { note?: string; memory?: string | null }[] = []
  const capture = (reply: string) => (context: TranscriptContext) => {
    seen.push({
      note: recalledIn(context),
      memory: sectionsOf(context).findLast((sections) => sections.memory)
        ?.memory,
    })
    return fauxAssistantMessage(reply)
  }
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall('remember', { text: 'Lives in Leeds', importance: 4 }),
        fauxToolCall('remember', {
          text: "Pip's waterproof coat is 66 cm, from Fell Houndwear",
          importance: 2,
        }),
      ],
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Noted.'),
    capture('Morning!'),
    capture('66 cm, from Fell Houndwear.'),
  ])
  await say('About me and Pip.')
  await say('Good morning!')
  const before = await memory()
  await say("What size is Pip's coat?")

  expect(seen[0].note).toBeUndefined()
  expect(seen[1].note).toMatch(
    /\nf2 \(since \d{4}-\d{2}-\d{2}\): Pip's waterproof coat is 66 cm/,
  )
  expect(seen[1].note).not.toContain('Leeds')
  expect(seen[1].memory).toBe(seen[0].memory)
  expect(seen[1].memory).not.toContain('Pip')
  // Recalling a fact records its use apart from the facts clients receive.
  expect(await memory()).toEqual(before)
})

test('the recall tool finds past facts, labelled as past', async () => {
  const { faux, say } = await setup()
  let results: string[] = []
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('remember', { text: 'Lives in Leeds', importance: 4 }),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Noted.'),
    fauxAssistantMessage(
      fauxToolCall('revise_memory', { id: 'f1', text: 'Lives in York' }),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Updated.'),
    fauxAssistantMessage(fauxToolCall('recall', { query: 'lived Leeds' }), {
      stopReason: 'toolUse',
    }),
    (context) => {
      results = toolResultsOf(context)
      return fauxAssistantMessage('Leeds.')
    },
  ])
  await say('I live in Leeds.')
  await say('I moved to York.')
  await say('Where did I live before?')
  expect(results.at(-1)).toMatch(
    /^f1 \(.* to .*, replaced by f2\): Lives in Leeds$/,
  )
})

/** Saves one fact outside core, so recall has something to show. */
const saveGreenTea = () => [
  fauxAssistantMessage(
    fauxToolCall('remember', { text: 'Prefers green tea', importance: 1 }),
    { stopReason: 'toolUse' },
  ),
  fauxAssistantMessage('Noted.'),
]

test('recall goes last, so a revision mid-run leaves the earlier messages unchanged', async () => {
  const { faux, say } = await setup()
  const requests: TranscriptContext['messages'][] = []
  faux.setResponses([
    ...saveGreenTea(),
    (context) => {
      requests.push(context.messages)
      return fauxAssistantMessage(
        fauxToolCall('revise_memory', { id: 'f1', text: 'Prefers black tea' }),
        { stopReason: 'toolUse' },
      )
    },
    (context) => {
      requests.push(context.messages)
      return fauxAssistantMessage('Black tea it is.')
    },
  ])
  await say('I like tea.')
  await say('Actually, I have switched to black tea.')

  const [first, second] = requests
  expect(recalledIn({ messages: first } as TranscriptContext)).toBe(
    first.at(-1)?.content,
  )
  expect(second.at(-1)?.content).toContain('replaced by f2')
  // Everything before the first request's note is the start of the second.
  expect(second.slice(0, first.length - 1)).toEqual(first.slice(0, -1))
})

test('a retried request recalls exactly what the first attempt did', async () => {
  const { faux, familiar, say } = await setup()
  const notes: (string | undefined)[] = []
  faux.setResponses([
    ...saveGreenTea(),
    async (context) => {
      notes.push(recalledIn(context))
      // Memory changes between the attempts.
      await familiar.memory.revise('f1', 'Prefers black tea')
      return fauxAssistantMessage('', {
        stopReason: 'error',
        errorMessage: '503 server busy',
      })
    },
    (context) => {
      notes.push(recalledIn(context))
      return fauxAssistantMessage('Tea, then.')
    },
  ])
  await say('I like tea.')
  await say('What tea do I like?')
  expect(notes[0]).toContain('f1 (since')
  expect(notes[1]).toBe(notes[0])
})
