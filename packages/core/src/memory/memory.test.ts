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
  MemoryUsage,
  openMemory,
  rememberFact,
  reviseFact,
} from './facts.ts'
import { readStored, storageWith } from './testing.ts'
import { createMemory } from './index.ts'
import { Upkeep } from './upkeep/schedule.ts'
import { harnessOptions } from '../context/index.ts'
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

/** Dismisses a Familiar before the test ends, so its storage can be read. */
const dismiss = async (familiar: Familiar) => {
  opened.splice(opened.indexOf(familiar), 1)
  await familiar.dismiss()
}

/** The system prompt sections of one request. */
const sectionsOf = (context: TranscriptContext) =>
  context.messages.flatMap((message) =>
    message.role === 'system' ? [message.sections ?? {}] : [],
  )

/** The names of the tools offered in one request. */
const toolsOf = (context: TranscriptContext) =>
  context.messages.flatMap((message) =>
    message.role === 'system'
      ? (message.toolsAdded ?? []).map((tool) => tool.name)
      : [],
  )

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

test('the conversation model reads memory but is never offered the tools that write it', async () => {
  const { faux, say } = await setup({
    storage: await storageWith(['Uses pnpm', 3]),
  })
  let tools: string[] = []
  let prompt: Record<string, string | null>[] = []
  faux.setResponses([
    (context) => {
      tools = toolsOf(context)
      prompt = sectionsOf(context)
      return fauxAssistantMessage('pnpm, as always.')
    },
  ])
  await say('Which package manager do I use? Remember that I like pnpm.')
  expect(tools).toContain('recall')
  for (const writer of ['remember', 'revise_memory', 'retire']) {
    expect(tools).not.toContain(writer)
  }
  const shown = prompt.findLast((sections) => sections.memory)?.memory
  expect(shown).toContain('f1: Uses pnpm')
  expect(shown).toContain('filed tonight')
})

test("only upkeep's conversation is given the tools that write facts", async () => {
  const registry = createRegistry()
  const model = { provider: 'faux', modelId: 'faux-1' }
  const harness = await Harness.open(
    new MemoryStorage(),
    harnessOptions({ models: createModels(), model }, registry, 64_000),
    BACKGROUND_CONTEXT,
  )
  try {
    const memory = createMemory(harness, {
      now: Date.now,
      model,
      name: 'Familiar',
      transcriptTokens: 1_000,
    })
    for (const extension of memory.extensions) {
      registry.install(extension)
    }
    const root = await harness.root(BACKGROUND_CONTEXT)
    await memory.start()
    // As a host's own extension might: a conversation that chooses nothing.
    const { other, upkeep } = await harness.commit(
      async (tx) => ({
        upkeep: (await tx.doc(Upkeep)).conversation!,
        other: (
          await tx.createConversation({ ownership: { kind: 'ownerless' } })
        ).id,
      }),
      BACKGROUND_CONTEXT,
    )
    const toolsIn = async (id: typeof other) =>
      (
        await (await harness.conversation(id, BACKGROUND_CONTEXT))!.agent(
          BACKGROUND_CONTEXT,
        )
      ).tools.map((tool) => tool.name)
    const writers = ['remember', 'revise_memory', 'retire']
    for (const tools of [await toolsIn(other), await toolsIn(root.id)]) {
      expect(tools).toContain('recall')
      expect(tools.filter((name) => writers.includes(name))).toEqual([])
    }
    expect(await toolsIn(upkeep)).toEqual(expect.arrayContaining(writers))
  } finally {
    await harness.close(BACKGROUND_CONTEXT)
  }
})

test('people can revise, retire and pin facts', async () => {
  const { familiar, memory } = await setup({
    storage: await storageWith(
      ['Lives in Leeds', 4],
      ['Has a cat', 3],
      ['Likes blue pens', 1],
    ),
  })
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
  await expect(familiar.memory.revise('f4', 'x'.repeat(301))).rejects.toThrow(
    'Split it',
  )
})

test('an edit that fails partway through a commit changes nothing', async () => {
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: createModels(), registry: createRegistry() },
    BACKGROUND_CONTEXT,
  )
  const fact = (text: string) => ({
    text,
    importance: 3,
    since: '2025-01-01',
    sources: [],
  })
  try {
    await harness.commit(async (tx) => {
      rememberFact(await openMemory(tx), fact('Lives in Leeds'), 10)
    }, BACKGROUND_CONTEXT)
    await expect(
      harness.commit(async (tx) => {
        const memory = await openMemory(tx)
        rememberFact(memory, fact('Has a cat'), 20)
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

test('the prompt shows current core facts within budget, and nothing past', async () => {
  const { faux, familiar, say, memory } = await setup({
    storage: await storageWith(
      ['Lives in Leeds', 5],
      ['Works at Northbank', 5],
      ...Array.from(
        { length: 70 },
        (_, index) =>
          [`Fact ${index}: ${'something worth keeping '.repeat(4)}`, 4] as [
            string,
            number,
          ],
      ),
    ),
  })
  await familiar.memory.revise('f1', 'Lives in York')
  await familiar.memory.retire('f2')
  let prompt: Record<string, string | null>[] = []
  faux.setResponses([
    (context) => {
      prompt = sectionsOf(context)
      return fauxAssistantMessage('York.')
    },
  ])
  const state = (await memory())!
  const core = coreFacts(state)
  expect(core.length).toBeLessThan(state.facts.length - 2)
  expect(listFacts(core).length).toBeLessThanOrEqual(CORE_BUDGET)

  await say('Where do I live?')
  const shown = prompt.findLast((sections) => sections.memory)?.memory ?? ''
  expect(shown).toContain(listFacts(core))
  expect(shown).toContain('f73: Lives in York')
  // Past facts and facts that didn't fit stay out.
  expect(shown).not.toContain('Leeds')
  expect(shown).not.toContain('Northbank')
  expect(shown).not.toContain('Fact 69:')
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
  const storage = await storageWith(
    ['Lives in Leeds', 4],
    ["Pip's waterproof coat is 66 cm, from Fell Houndwear", 2],
  )
  const { faux, familiar, say, memory } = await setup({ storage })
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
    capture('Morning!'),
    capture('66 cm, from Fell Houndwear.'),
  ])
  await say('Good morning!')
  const before = await memory()
  await say("What size is Pip's coat?")

  expect(seen[0].note).toBeUndefined()
  expect(seen[1].note).toMatch(
    /\nf2 \(since 2026-01-05\): Pip's waterproof coat is 66 cm/,
  )
  expect(seen[1].note).not.toContain('Leeds')
  expect(seen[1].memory).toBe(seen[0].memory)
  expect(seen[1].memory).not.toContain('Pip')
  // Recalling a fact records its use apart from the facts clients receive.
  expect(await memory()).toEqual(before)
  await dismiss(familiar)
  expect((await readStored(storage, MemoryUsage)).facts).toEqual({
    f2: { recalled: expect.any(Number) },
  })
})

test('the recall tool finds past facts, labelled as past', async () => {
  const storage = await storageWith(['Lives in Leeds', 4])
  const { faux, familiar, say } = await setup({ storage })
  await familiar.memory.revise('f1', 'Lives in York')
  let results: string[] = []
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('recall', { query: 'lived Leeds' }), {
      stopReason: 'toolUse',
    }),
    (context) => {
      results = toolResultsOf(context)
      return fauxAssistantMessage('Leeds.')
    },
  ])
  // Matches no fact, so only the tool's search records a use.
  await say('Anything from the past?')
  expect(results.at(-1)).toMatch(
    /^f1 \(2026-01-05 to .*, replaced by f2\): Lives in Leeds$/,
  )
  // What the conversation's search found counts as used.
  await dismiss(familiar)
  expect((await readStored(storage, MemoryUsage)).facts.f1?.recalled).toEqual(
    expect.any(Number),
  )
})

test('recall goes last, so a revision mid-run leaves the earlier messages unchanged', async () => {
  const { faux, familiar, say } = await setup({
    storage: await storageWith(['Prefers green tea', 1]),
  })
  const requests: TranscriptContext['messages'][] = []
  faux.setResponses([
    async (context) => {
      requests.push(context.messages)
      await familiar.memory.revise('f1', 'Prefers black tea')
      return fauxAssistantMessage(fauxToolCall('current_time', {}), {
        stopReason: 'toolUse',
      })
    },
    (context) => {
      requests.push(context.messages)
      return fauxAssistantMessage('Black tea it is.')
    },
  ])
  await say('What tea do I like?')

  const [first, second] = requests
  expect(recalledIn({ messages: first } as TranscriptContext)).toBe(
    first.at(-1)?.content,
  )
  // Everything before the first request's note is the start of the second.
  expect(second.slice(0, first.length - 1)).toEqual(first.slice(0, -1))
})

test('a retried request recalls exactly what the first attempt did', async () => {
  const { faux, familiar, say } = await setup({
    storage: await storageWith(['Prefers green tea', 1]),
  })
  const notes: (string | undefined)[] = []
  faux.setResponses([
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
  await say('What tea do I like?')
  expect(notes[0]).toContain('f1 (since')
  expect(notes[1]).toBe(notes[0])
})
