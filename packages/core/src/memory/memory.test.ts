import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import type { AssistantMessage, TranscriptContext } from '@earendil-works/pi-ai'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  createRegistry,
  Harness,
  MemoryStorage,
  ROOT_CONVERSATION_ID,
} from '@earendil-works/pi-durable'
import { CORE_BUDGET, coreFacts, listFacts, MemoryUsage } from './facts.ts'
import { readStored, storageWith, withHarness } from './testing.ts'
import {
  fakeClock,
  ReopenableStorage,
  TEST_ZONE,
  testHost,
  timeAt,
} from '../testing.ts'
import { nextUpkeep } from './upkeep/schedule.ts'
import { createMemory } from './index.ts'
import { Upkeep } from './upkeep/schedule.ts'
import { harnessOptions } from '../harness.ts'
import { expect, test, vi } from 'vitest'
import { type Familiar, type FamiliarOptions } from '../familiar.ts'

type SetupOptions = Partial<Omit<FamiliarOptions, 'models' | 'model'>> & {
  contextWindow?: number
}

// A scripted model: each test lists what it replies, so Familiar runs for real
// (storage, tools, prompt) with no network.
async function setup({ contextWindow, ...options }: SetupOptions = {}) {
  const host = await testHost({
    faux: [{ id: 'faux-1', contextWindow }],
    timeZone: TEST_ZONE,
    ...options,
  })
  const familiar = host.familiar()
  const memory = async () => {
    const watch = await familiar.memory.watch()
    await watch.stop()
    return watch.value
  }
  return {
    faux: host.faux,
    familiar,
    say: host.say,
    memory,
    dismiss: host.dismiss,
  }
}

/** The system prompt sections of one request. */
const sectionsOf = (context: TranscriptContext) =>
  context.messages.flatMap((message) =>
    message.role === 'system' ? [message.sections ?? {}] : [],
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

test("only upkeep's conversation is given the tools that write facts, whatever another chooses", async () => {
  const registry = createRegistry()
  const model = { provider: 'faux', modelId: 'faux-1' }
  const harness = await Harness.open(
    new MemoryStorage(),
    harnessOptions(
      { models: createModels(), model, chatModels: [] },
      registry,
      64_000,
    ),
    BACKGROUND_CONTEXT,
  )
  try {
    const memory = createMemory(harness, {
      now: Date.now,
      model,
      thinkingLevel: 'low',
      name: 'Familiar',
      transcriptTokens: 1_000,
      timeZone: TEST_ZONE,
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
  const { faux, say, memory, dismiss } = await setup({ storage })
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
  await dismiss()
  expect((await readStored(storage, MemoryUsage)).facts).toEqual({
    f2: { recalled: expect.any(Number) },
  })
})

test("recall searches a person's words, not the line naming them", async () => {
  const storage = await storageWith(['Aidan keeps bees in the garden', 2])
  const { faux, say } = await setup({ storage })
  const notes: (string | undefined)[] = []
  const capture = (context: TranscriptContext) => {
    notes.push(recalledIn(context))
    return fauxAssistantMessage('Noted.')
  }
  faux.setResponses([capture, capture])
  // Sent by aidan, but says nothing about Aidan or bees.
  await say('Good morning!')
  await say('How are the bees?')
  expect(notes[0]).toBeUndefined()
  expect(notes[1]).toContain('Aidan keeps bees')
})

test('messages queued behind a reply are each recalled for in their own run', async () => {
  const storage = await storageWith(['Keeps bees in the garden', 2])
  const { faux, familiar } = await setup({ storage })
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  const notes: (string | undefined)[] = []
  const capture = async (context: TranscriptContext) => {
    notes.push(recalledIn(context))
    await held
    return fauxAssistantMessage('Noted.')
  }
  faux.setResponses([capture, capture, capture])
  const send = (author: string, text: string) =>
    familiar.send({
      author: { id: author, name: author },
      text,
      // Each test message starts differently; a request ID has a bound.
      requestId: text.slice(0, 128),
    })
  await send('ann', 'How are the bees?')
  await vi.waitFor(() => expect(notes).toHaveLength(1))
  await send('bob', 'Thanks')
  await send('carol', 'And the bees now?')
  release()
  await familiar.idle()
  expect(notes.map((note) => note?.includes('Keeps bees'))).toEqual([
    true,
    undefined,
    true,
  ])
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

type Faux = Awaited<ReturnType<typeof setup>>['faux']
type Step = (context: TranscriptContext) => AssistantMessage

/**
 * Answers compaction's summary requests itself and every other request from
 * `steps` in turn, then 'Lovely.', so compaction never takes a scripted step.
 */
const script = (faux: Faux, steps: Step[] = []) => {
  const respond = (context: TranscriptContext) => {
    faux.appendResponses([respond])
    if (JSON.stringify(context.messages[0]).includes('context summarization')) {
      return fauxAssistantMessage('## Goal\nThe weather.')
    }
    return steps.shift()?.(context) ?? fauxAssistantMessage('Lovely.')
  }
  faux.setResponses([respond])
}

/** Says something worth remembering, then enough weather to compact it away. */
const compactAway = async (
  familiar: Familiar,
  say: (text: string) => Promise<void>,
) => {
  await say('My bike lock code is 7291, keep it safe.')
  for (let day = 1; day <= 20; day++) {
    await say(`Day ${day}: the weather was ${'mild and grey, '.repeat(20)}`)
  }
  const view = await familiar.watch()
  await view.stop()
  expect(JSON.stringify(view.value.entries)).not.toContain('7291')
}

const compacting = { contextWindow: 16_000, contextBudget: 2_000 }

test('automatic recall and the recall tool find an exchange compaction took out of the context', async () => {
  const { faux, familiar, say } = await setup(compacting)
  script(faux)
  await compactAway(familiar, say)

  let note: string | undefined
  let results: string[] = []
  script(faux, [
    (context) => {
      note = recalledIn(context)
      return fauxAssistantMessage(
        fauxToolCall('recall', { query: 'bike lock code' }),
        { stopReason: 'toolUse' },
      )
    },
    (context) => {
      results = toolResultsOf(context)
      return fauxAssistantMessage('7291.')
    },
  ])
  await say('What was my bike lock code?')
  expect(note).toMatch(
    /Earlier conversation, not yet reviewed:\nx\d+ \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\): \{"id":"aidan","name":"aidan"\}: My bike lock code is 7291/,
  )
  expect(results.at(-1)).toMatch(
    /Exchanges:\nx\d+ \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\): \{"id":"aidan","name":"aidan"\}: My bike lock code is 7291/,
  )
})

test("a compaction's summary, stored after the message it kept, doesn't hide that message from recall", async () => {
  const { faux, familiar, say } = await setup({
    storage: await storageWith(['Aidan keeps bees in the garden', 2]),
    ...compacting,
  })
  const notes: (string | undefined)[] = []
  const step: Step = (context) => {
    notes.push(recalledIn(context))
    return fauxAssistantMessage('Lovely.')
  }
  script(
    faux,
    Array.from({ length: 20 }, () => step),
  )
  for (let day = 1; day <= 20; day++) {
    await say(`Day ${day}: the weather was ${'mild and grey, '.repeat(20)}`)
  }

  const view = await familiar.watch()
  await view.stop()
  const [summary] = view.value.entries
  expect(summary.kind).toBe('pi.compaction')
  expect(summary.id).toBeGreaterThan(view.value.entries[1].id)
  // Recall searched each day's words, never the summary or aidan's name.
  expect(notes).toHaveLength(20)
  expect(notes.join('\n')).not.toContain('bees')
})

test('automatic recall leaves out what is still in view and what upkeep has reviewed', async () => {
  const storage = new ReopenableStorage()
  const first = await setup({ storage, ...compacting })
  let note: string | undefined
  // Before any compaction, everything is in view.
  script(first.faux, [
    (context) => {
      note = recalledIn(context)
      return fauxAssistantMessage('Noted.')
    },
  ])
  await first.say('My bike lock code is 7291.')
  await first.say('What was my bike lock code again?')
  expect(note).toBeUndefined()

  await compactAway(first.familiar, first.say)
  await first.dismiss()
  // As if tonight's pass had reviewed everything so far.
  await withHarness(storage, (harness) =>
    harness.commit(async (tx) => {
      const { items } = await tx.scanEntries(
        { conversationId: ROOT_CONVERSATION_ID, order: 'descending' },
        1,
      )
      ;(await tx.doc(Upkeep)).through = items[0].id
    }, BACKGROUND_CONTEXT),
  )

  const second = await setup({ storage, ...compacting })
  note = 'unset'
  script(second.faux, [
    (context) => {
      note = recalledIn(context)
      return fauxAssistantMessage('Noted.')
    },
  ])
  await second.say('What was my bike lock code?')
  expect(note).toBeUndefined()
})

test('upkeep passes are not shown unfiled exchanges', async () => {
  const clock = fakeClock(timeAt('2026-10-25 12:00'))
  const { faux, familiar, say } = await setup({
    ...compacting,
    now: clock.now,
    setTimer: clock.setTimer,
  })
  script(faux)
  await compactAway(familiar, say)

  const notes: (string | undefined)[] = []
  const review: Step = (context) => {
    notes.push(recalledIn(context))
    return fauxAssistantMessage('A day of weather and a bike lock.')
  }
  script(faux, [review, review])
  clock.advanceTo(nextUpkeep(clock.now(), TEST_ZONE))
  await vi.waitFor(() => expect(notes.length).toBeGreaterThan(0))
  expect(notes.join('\n')).not.toContain('Earlier conversation')
})
