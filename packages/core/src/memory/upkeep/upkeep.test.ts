import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import type { TranscriptContext } from '@earendil-works/pi-ai'
import {
  createRegistry,
  defineDoc,
  Harness,
  MemoryStorage,
  type SetTimer,
} from '@earendil-works/pi-durable'
import { nextUpkeep } from './schedule.ts'
import { afterEach, expect, test, vi } from 'vitest'
import { summonFamiliar, type Familiar } from '../../familiar.ts'
import { storageWith } from '../testing.ts'

const context = BACKGROUND_CONTEXT

// Closing a Familiar closes its storage; this one keeps its state for a reopen.
class ReopenableStorage extends MemoryStorage {
  override async close() {}
}

/** A clock that moves only when told to, firing the timers that fall due. */
function fakeClock(start: number) {
  let now = start
  let timers: { due: number; fire: () => void }[] = []
  const setTimer: SetTimer = (fire, delayMs, { background }) => {
    if (background) {
      return undefined
    } // only frees memory
    const timer = { due: now + delayMs, fire }
    timers.push(timer)
    return () => {
      timers = timers.filter((other) => other !== timer)
    }
  }
  const advanceTo = (time: number) => {
    now = time
    const due = timers.filter((timer) => timer.due <= now)
    timers = timers.filter((timer) => timer.due > now)
    for (const timer of due) {
      timer.fire()
    }
  }
  return {
    now: () => now,
    setTimer,
    advanceTo,
    setTime: (time: number) => {
      now = time
    },
  }
}

const start = new Date(2026, 9, 25, 12).getTime() // local noon
const firstPass = nextUpkeep(start)
const secondPass = nextUpkeep(firstPass)

async function setup(storage: MemoryStorage = new ReopenableStorage()) {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const clock = fakeClock(start)

  const open = async () => {
    const familiar = await summonFamiliar({
      storage,
      models,
      model: { provider: 'faux', modelId: 'faux-1' },
      now: clock.now,
      setTimer: clock.setTimer,
    })
    opened.push(familiar)
    return familiar
  }
  let familiar = await open()
  const reopen = async () => {
    await familiar.dismiss()
    opened.splice(opened.indexOf(familiar), 1)
    familiar = await open()
  }

  const say = async (text: string) => {
    await familiar.send({ author: 'aidan', text, requestId: text })
    await familiar.idle()
  }
  const memory = async () => {
    const watch = await familiar.memory.watch()
    await watch.stop()
    return watch.value?.facts ?? []
  }
  const episodes = async () => {
    const watch = await familiar.memory.watchEpisodes()
    await watch.stop()
    return watch.value?.episodes ?? []
  }
  const upkeepTasks = async () =>
    (
      await storage.scanTasks(
        { kind: 'familiar.upkeep' },
        10,
        undefined,
        context,
      )
    ).items
  const sleepingUntil = (time: number) =>
    vi.waitFor(async () =>
      expect((await upkeepTasks())[0]?.state).toMatchObject({
        status: 'sleeping',
        until: time,
      }),
    )
  /** Moves the clock to `time` and waits for the task to sleep until `next`. */
  const passAt = async (time: number, next: number) => {
    clock.advanceTo(time)
    await sleepingUntil(next)
  }
  return {
    faux,
    familiar: () => familiar,
    say,
    setTime: clock.setTime,
    memory,
    episodes,
    upkeepTasks,
    sleepingUntil,
    passAt,
    reopen,
  }
}

const opened: Familiar[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((familiar) => familiar.dismiss()))
})

/** The pass's input: the last user message of an upkeep request, before any recall note. */
const inputOf = (context: TranscriptContext) => {
  const text = (message: TranscriptContext['messages'][number]) =>
    message.role !== 'user'
      ? ''
      : typeof message.content === 'string'
        ? message.content
        : message.content
            .map((part) => (part.type === 'text' ? part.text : ''))
            .join('')
  return (
    context.messages
      .map(text)
      .findLast(
        (input) => input && !input.startsWith('Recalled from memory'),
      ) ?? ''
  )
}

const isUpkeep = (context: TranscriptContext) =>
  JSON.stringify(context.messages).includes('long-term memory of Familiar')

/** The exchange ID upkeep's input gives the person's line containing `text`. */
const exchangeIn = (input: string, text: string) =>
  input
    .split('\n')
    .find((line) => line.includes(text))
    ?.match(/^\[(x\d+) /)?.[1] ?? 'missing'

test('a pass at 04:00 files facts with their sources and days', async () => {
  const { faux, say, memory, passAt } = await setup(
    await storageWith(['Has a cat', 3], ['Owns a cat called Miso', 3]),
  )
  faux.setResponses([fauxAssistantMessage('Noted.')])
  await say('I have a cat called Miso, and I am vegetarian.')

  let input = ''
  faux.setResponses([
    (context) => {
      expect(isUpkeep(context)).toBe(true)
      input = inputOf(context)
      const source = exchangeIn(input, 'vegetarian')
      return fauxAssistantMessage(
        [
          fauxToolCall('revise_memory', {
            id: 'f2',
            text: 'Owns a cat called Miso',
            sources: [source],
            merge: ['f1'],
          }),
          fauxToolCall('remember', {
            text: 'Is vegetarian',
            importance: 4,
            sources: [source],
          }),
        ],
        { stopReason: 'toolUse' },
      )
    },
    fauxAssistantMessage('Merged the cat facts and saved one.'),
  ])
  expect(faux.getPendingResponseCount()).toBe(2)
  await passAt(firstPass, secondPass)

  expect(faux.getPendingResponseCount()).toBe(0)
  expect(input).toMatch(
    /\[x\d+ 2026-10-25 12:00\] aidan: I have a cat called Miso/,
  )
  expect(input).toContain('Familiar: Noted.')
  const source = Number(exchangeIn(input, 'vegetarian').slice(1))
  // Merged duplicates stay as history; only current facts are believed.
  expect(
    (await memory())
      .filter((fact) => fact.until === undefined)
      .map(({ text, replaces, sources, since }) => ({
        text,
        replaces,
        sources,
        since,
      })),
  ).toEqual([
    {
      text: 'Owns a cat called Miso',
      replaces: ['f2', 'f1'],
      sources: [source],
      since: '2026-10-25',
    },
    {
      text: 'Is vegetarian',
      replaces: undefined,
      sources: [source],
      since: '2026-10-25',
    },
  ])
  expect(await memory()).toHaveLength(4)
})

test("a pass rejects sources that are not people's messages", async () => {
  const { faux, familiar, say, memory, passAt } = await setup()
  faux.setResponses([fauxAssistantMessage('Noted.')])
  await say('I am vegetarian.')
  const view = await familiar().watch()
  await view.stop()
  const reply = view.value.entries.find(
    (entry) => entry.kind === 'pi.assistant',
  )

  let results = ''
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall('remember', {
          text: 'Is vegetarian',
          importance: 4,
          sources: [`x${reply!.id}`],
        }),
        fauxToolCall('remember', {
          text: 'Is vegetarian',
          importance: 4,
          sources: ['x9999'],
        }),
      ],
      { stopReason: 'toolUse' },
    ),
    (context) => {
      results = JSON.stringify(
        context.messages.filter((message) => message.role === 'toolResult'),
      )
      return fauxAssistantMessage('Nothing filed.')
    },
  ])
  await passAt(firstPass, secondPass)
  expect(results).toContain(`x${reply!.id} is not a message from a person`)
  expect(results).toContain('x9999 is not a message from a person')
  expect(await memory()).toEqual([])
})

test('something the owner asks Familiar to remember is a fact after the next pass', async () => {
  const { faux, say, passAt } = await setup()
  faux.setResponses([fauxAssistantMessage("I'll remember that.")])
  await say('Please remember that my locker code is 4417.')

  let instructions = ''
  faux.setResponses([
    (context) => {
      instructions = JSON.stringify(context.messages[0])
      return fauxAssistantMessage(
        fauxToolCall('remember', {
          text: 'Locker code is 4417',
          importance: 5,
          sources: [exchangeIn(inputOf(context), 'locker code')],
        }),
        { stopReason: 'toolUse' },
      )
    },
    fauxAssistantMessage('Shared a locker code.'),
  ])
  await passAt(firstPass, secondPass)
  expect(instructions).toContain(
    'Always save anything someone explicitly asked Familiar to remember',
  )

  let prompt = ''
  faux.setResponses([
    (context) => {
      prompt = JSON.stringify(context.messages)
      return fauxAssistantMessage('4417.')
    },
  ])
  await say('What is my locker code?')
  expect(prompt).toContain('f1: Locker code is 4417')
})

test('a pass sees only messages since the previous one', async () => {
  const { faux, say, passAt } = await setup()
  const inputs: string[] = []
  const upkeepReply = (context: TranscriptContext) => {
    inputs.push(JSON.stringify(context.messages))
    return fauxAssistantMessage('Nothing to change.')
  }

  faux.setResponses([fauxAssistantMessage('Enjoy Lisbon.'), upkeepReply])
  await say('We fly to Lisbon on Friday.')
  await passAt(firstPass, secondPass)

  faux.setResponses([fauxAssistantMessage('Welcome back.'), upkeepReply])
  await say('We are back from Porto.')
  await passAt(secondPass, nextUpkeep(secondPass))

  expect(inputs).toHaveLength(2)
  expect(inputs[0]).toContain('Lisbon')
  expect(inputs[1]).toContain('Porto')
  // Neither in its input nor left over in the upkeep conversation.
  expect(inputs[1]).not.toContain('Lisbon')
})

test('no pass runs when nothing new was said', async () => {
  const { faux, say, passAt } = await setup()
  await passAt(firstPass, secondPass) // nothing said yet
  expect(faux.state.callCount).toBe(0)

  faux.setResponses([
    fauxAssistantMessage('Hello.'),
    fauxAssistantMessage('Nothing to change.'),
  ])
  await say('Hi.')
  await passAt(secondPass, nextUpkeep(secondPass))
  expect(faux.state.callCount).toBe(2)

  const third = nextUpkeep(secondPass)
  await passAt(third, nextUpkeep(third))
  expect(faux.state.callCount).toBe(2)
})

test('reopening keeps exactly one upkeep task on its schedule', async () => {
  const { faux, say, upkeepTasks, sleepingUntil, passAt, reopen } =
    await setup()
  await sleepingUntil(firstPass)
  const [before] = await upkeepTasks()

  await reopen()
  await reopen()
  const after = await upkeepTasks()
  expect(after).toHaveLength(1)
  expect(after[0]?.id).toBe(before?.id)
  expect(after[0]?.state).toMatchObject({
    status: 'sleeping',
    until: firstPass,
  })

  let passes = 0
  faux.setResponses([
    fauxAssistantMessage('Hello.'),
    () => {
      passes++
      return fauxAssistantMessage('Nothing to change.')
    },
  ])
  await say('Hi.')
  await passAt(firstPass, secondPass)
  expect(passes).toBe(1)
})

test('a later pass revises a fact saved outside core instead of duplicating it', async () => {
  const { faux, say, memory, passAt } = await setup(
    await storageWith(['Prefers green tea', 1]),
  )
  const recalledIn = (context: TranscriptContext) =>
    JSON.stringify(context.messages).includes('f1 (since')
  expect((await memory())[0].core).toBe(false)

  faux.setResponses([fauxAssistantMessage('Noted.')])
  await say('I have switched to black tea now.')

  let sawFact = false
  faux.setResponses([
    (context) => {
      expect(isUpkeep(context)).toBe(true)
      sawFact = recalledIn(context)
      return fauxAssistantMessage(
        fauxToolCall('revise_memory', {
          id: 'f1',
          text: 'Prefers black tea',
          sources: [exchangeIn(inputOf(context), 'black tea')],
        }),
        { stopReason: 'toolUse' },
      )
    },
    fauxAssistantMessage('Revised the tea preference.'),
  ])
  await passAt(firstPass, secondPass)

  expect(sawFact).toBe(true)
  expect(await memory()).toMatchObject([
    { id: 'f1', since: '2026-01-05', until: '2026-10-25' },
    {
      id: 'f2',
      text: 'Prefers black tea',
      replaces: ['f1'],
      since: '2026-10-25',
    },
  ])
})

test('a pass can search for a fact its automatic recall missed', async () => {
  const topics = Array.from(
    { length: 10 },
    (_, index) =>
      `Topic ${index}: switched to a new routine for the garden now`,
  )
  const { faux, say, memory, passAt } = await setup(
    await storageWith(
      ['Prefers green tea', 1],
      ...topics.map((text) => [text, 1] as [string, number]),
    ),
  )
  faux.setResponses([fauxAssistantMessage('Noted.')])
  await say(
    `I have switched to black tea now. ${topics.join('. ')}. The garden routine is new.`,
  )

  let automatic = ''
  let searched = ''
  faux.setResponses([
    (context) => {
      expect(isUpkeep(context)).toBe(true)
      automatic = JSON.stringify(context.messages.at(-1))
      return fauxAssistantMessage(fauxToolCall('recall', { query: 'tea' }), {
        stopReason: 'toolUse',
      })
    },
    (context) => {
      const last = context.messages.findLast(
        (message) => message.role === 'toolResult',
      )
      searched = JSON.stringify(last)
      return fauxAssistantMessage(
        fauxToolCall('revise_memory', { id: 'f1', text: 'Prefers black tea' }),
        { stopReason: 'toolUse' },
      )
    },
    fauxAssistantMessage('Revised the tea preference.'),
  ])
  await passAt(firstPass, secondPass)

  // Crowded out of the automatic eight, but found by a targeted search.
  expect(automatic).toContain('Recalled from memory')
  expect(automatic).not.toContain('green tea')
  expect(searched).toContain('f1 (since')
  expect(
    (await memory())
      .filter((fact) => fact.until === undefined)
      .map((fact) => fact.text),
  ).toContain('Prefers black tea')
})

test("a pass writes the day's episode, rebalances core, and Monday's pass rolls up the week", async () => {
  const { faux, say, memory, episodes, passAt } = await setup(
    await storageWith(['Plants bulbs with Noor', 3]),
  )
  faux.setResponses([fauxAssistantMessage('Lovely.')])
  // Sunday 25 October 2026; the first pass is Monday at 04:00.
  await say('I spent today planting bulbs with Noor.')
  expect((await memory())[0].core).toBe(true)

  let rollupInput = ''
  let rollupTools: unknown[] = ['not called']
  const toolsIn = (context: TranscriptContext) =>
    context.messages.flatMap((message) =>
      message.role === 'system' ? (message.toolsAdded ?? []) : [],
    )
  let reviewTools: unknown[] = []
  faux.setResponses([
    (context) => {
      reviewTools = toolsIn(context)
      return fauxAssistantMessage(fauxToolCall('retire', { id: 'f1' }), {
        stopReason: 'toolUse',
      })
    },
    fauxAssistantMessage('Rowan planted bulbs with Noor on Sunday.'),
    (context) => {
      // Its own conversation: summarising instructions and no tools, so a
      // rollup can't change facts.
      expect(JSON.stringify(context.messages)).toContain(
        'You write the episodes of Familiar',
      )
      rollupTools = toolsIn(context)
      rollupInput = inputOf(context)
      return fauxAssistantMessage('A quiet week ending in bulb planting.')
    },
  ])
  await passAt(firstPass, secondPass)

  expect(await episodes()).toMatchObject([
    {
      id: 'e1',
      span: 'day',
      start: '2026-10-25',
      end: '2026-10-25',
      text: 'Rowan planted bulbs with Noor on Sunday.',
    },
    {
      id: 'e2',
      span: 'week',
      start: '2026-10-19',
      end: '2026-10-25',
      text: 'A quiet week ending in bulb planting.',
    },
  ])
  expect(reviewTools).not.toEqual([])
  expect(rollupTools).toEqual([])
  expect(rollupInput).toContain('The week of 2026-10-19 to 2026-10-25:')
  expect(rollupInput).toContain(
    '2026-10-25: Rowan planted bulbs with Noor on Sunday.',
  )
  // Retired on the day being filed, so rebalancing moved it out of core;
  // it is still kept.
  expect(await memory()).toMatchObject([
    { id: 'f1', core: false, until: '2026-10-25' },
  ])

  let note = ''
  faux.setResponses([
    (context) => {
      note = JSON.stringify(context.messages.at(-1))
      return fauxAssistantMessage('You planted bulbs.')
    },
  ])
  await say('What was I doing with Noor last week?')
  expect(note).toContain('e1 (day of 2026-10-25)')
})

test('a review that ends without its episode is asked for it once more', async () => {
  const { faux, say, episodes, passAt } = await setup()
  faux.setResponses([fauxAssistantMessage('Lovely.')])
  await say('I spent today planting bulbs with Noor.')

  let followUp = ''
  faux.setResponses([
    fauxAssistantMessage(''),
    (context) => {
      followUp = inputOf(context)
      return fauxAssistantMessage('Rowan planted bulbs with Noor.')
    },
    fauxAssistantMessage('A week of bulbs.'),
  ])
  await passAt(firstPass, secondPass)
  expect(followUp).toBe(
    'Now reply with only the episode for that conversation.',
  )
  expect((await episodes()).map(({ span, text }) => [span, text])).toEqual([
    ['day', 'Rowan planted bulbs with Noor.'],
    ['week', 'A week of bulbs.'],
  ])
})

test('a pass that still writes no episode moves on rather than repeat itself', async () => {
  const { faux, say, episodes, passAt } = await setup()
  faux.setResponses([fauxAssistantMessage('Lovely.')])
  await say('I spent today planting bulbs with Noor.')
  faux.setResponses([fauxAssistantMessage(''), fauxAssistantMessage('')])
  await passAt(firstPass, secondPass)
  expect(await episodes()).toEqual([])

  faux.setResponses([fauxAssistantMessage('Good.')])
  await say('I tidied the shed.')
  let input = ''
  faux.setResponses([
    (context) => {
      input = inputOf(context)
      return fauxAssistantMessage('Rowan tidied the shed.')
    },
  ])
  await passAt(secondPass, nextUpkeep(secondPass))
  // The next night reviews only what's new.
  expect(input).toContain('tidied the shed')
  expect(input).not.toContain('planting bulbs')
})

test('upkeep saved before episodes opens, gains its rollup conversation and keeps one task', async () => {
  const storage = new ReopenableStorage()
  const UpkeepV1 = defineDoc<{
    conversation: null
    task: null
    through: number | null
  }>({
    kind: 'familiar.upkeep',
    version: 1,
    scope: 'session',
    initial: () => ({ conversation: null, task: null, through: null }),
    checkpointWhen: () => true,
  })
  const old = await Harness.open(
    storage,
    { models: createModels(), registry: createRegistry() },
    context,
  )
  await old.commit(async (tx) => void (await tx.doc(UpkeepV1)), context)
  await old.close(context)

  const { faux, say, episodes, upkeepTasks, passAt, reopen } =
    await setup(storage)
  await reopen()
  expect(await upkeepTasks()).toHaveLength(1)

  faux.setResponses([fauxAssistantMessage('Lovely.')])
  await say('I spent today planting bulbs with Noor.')
  faux.setResponses([
    fauxAssistantMessage('Rowan planted bulbs with Noor.'),
    (context) => {
      // Rollups run in the conversation the migration made room for.
      expect(JSON.stringify(context.messages)).toContain(
        'You write the episodes of Familiar',
      )
      return fauxAssistantMessage('A week of bulbs.')
    },
  ])
  await passAt(firstPass, secondPass)
  expect((await episodes()).map(({ span }) => span)).toEqual(['day', 'week'])
})

test('a busy day reviews every message in ordered batches before its rollup', async () => {
  const { faux, say, episodes, passAt, reopen } = await setup()
  const messages = ['first', 'second'].map(
    (label) => `${label}: ${'detail '.repeat(8_000)} end-${label}`,
  )
  faux.setResponses([
    fauxAssistantMessage('First reply.'),
    fauxAssistantMessage('Second reply.'),
  ])
  for (const message of messages) {
    await say(message)
  }

  const inputs: string[] = []
  const review = (context: TranscriptContext) => {
    inputs.push(inputOf(context))
    return fauxAssistantMessage(`Batch ${inputs.length}.`)
  }
  let rollupInput = ''
  faux.setResponses([
    review,
    review,
    (context) => {
      rollupInput = inputOf(context)
      return fauxAssistantMessage('Both batches.')
    },
  ])
  await passAt(firstPass, secondPass)
  expect(inputs).toHaveLength(2)
  expect(inputs[0]).toContain(messages[0])
  expect(inputs[0]).not.toContain('end-second')
  expect(inputs[1]).toContain(messages[1])
  expect(inputs[1]).not.toContain('end-first')
  expect(inputs.join('\n')).toContain('First reply.')
  expect(inputs.join('\n')).toContain('Second reply.')
  expect(rollupInput).toContain('Batch 1.')
  expect(rollupInput).toContain('Batch 2.')
  expect(
    (await episodes()).map(({ span, start, end }) => [span, start, end]),
  ).toEqual([
    ['day', '2026-10-25', '2026-10-25'],
    ['day', '2026-10-25', '2026-10-25'],
    ['week', '2026-10-19', '2026-10-25'],
  ])
  await reopen()
  const calls = faux.state.callCount
  await passAt(secondPass, nextUpkeep(secondPass))
  expect(faux.state.callCount).toBe(calls)
})

test('a backlog is split at 04:00 and all days are reviewed before rollups', async () => {
  const { faux, say, setTime, episodes, passAt } = await setup()
  faux.setResponses([
    fauxAssistantMessage('Sunday reply.'),
    fauxAssistantMessage('Monday reply.'),
  ])
  await say('Sunday news.')
  // Simulate downtime in the scheduler while recording another day of chat.
  setTime(firstPass + 60 * 60 * 1000)
  await say('Monday news.')
  const inputs: string[] = []
  const review = (context: TranscriptContext) => {
    inputs.push(inputOf(context))
    return fauxAssistantMessage(`Day ${inputs.length}.`)
  }
  let rollupInput = ''
  faux.setResponses([
    review,
    review,
    (context) => {
      rollupInput = inputOf(context)
      return fauxAssistantMessage('Sunday week.')
    },
  ])
  await passAt(secondPass, nextUpkeep(secondPass))
  expect(inputs).toHaveLength(2)
  expect(inputs[0]).toContain('Sunday news.')
  expect(inputs[0]).not.toContain('Monday news.')
  expect(inputs[1]).toContain('Monday news.')
  expect(inputs[1]).not.toContain('Sunday news.')
  expect((await episodes()).filter(({ span }) => span === 'day')).toMatchObject(
    [
      { start: '2026-10-25', end: '2026-10-25' },
      { start: '2026-10-26', end: '2026-10-26' },
    ],
  )
  expect(rollupInput).toContain('Day 1.')
  expect(rollupInput).not.toContain('Day 2.')
})

test('a failed later batch keeps earlier progress across a restart and delays rollups', async () => {
  const { faux, say, episodes, passAt, reopen } = await setup()
  const messages = ['first', 'second'].map(
    (label) => `${label}: ${'detail '.repeat(8_000)} end-${label}`,
  )
  faux.setResponses([
    fauxAssistantMessage('First reply.'),
    fauxAssistantMessage('Second reply.'),
  ])
  for (const message of messages) {
    await say(message)
  }
  faux.setResponses([
    fauxAssistantMessage('First batch episode.'),
    fauxAssistantMessage('', {
      stopReason: 'error',
      errorMessage: 'insufficient_quota',
    }),
  ])
  await passAt(firstPass, secondPass)
  expect((await episodes()).map(({ span, text }) => [span, text])).toEqual([
    ['day', 'First batch episode.'],
  ])
  await reopen()
  let input = ''
  let rollupInput = ''
  faux.setResponses([
    (context) => {
      input = inputOf(context)
      return fauxAssistantMessage('Second batch episode.')
    },
    (context) => {
      rollupInput = inputOf(context)
      return fauxAssistantMessage('Both batches.')
    },
  ])
  await passAt(secondPass, nextUpkeep(secondPass))
  expect(input).toContain(messages[1])
  expect(input).not.toContain('end-first')
  expect(rollupInput).toContain('First batch episode.')
  expect(rollupInput).toContain('Second batch episode.')
  expect((await episodes()).map(({ span }) => span)).toEqual([
    'day',
    'day',
    'week',
  ])
})

test('an oversized single message is bounded and does not strand the messages after it', async () => {
  const { faux, say, passAt } = await setup()
  faux.setResponses([fauxAssistantMessage('Reply after the long message.')])
  await say(`Long message: ${'detail '.repeat(17_000)} end-long`)
  const inputs: string[] = []
  const review = (context: TranscriptContext) => {
    inputs.push(inputOf(context))
    return fauxAssistantMessage(`Batch ${inputs.length}.`)
  }
  faux.setResponses([review, review, fauxAssistantMessage('Week.')])
  await passAt(firstPass, secondPass)
  expect(inputs).toHaveLength(2)
  expect(inputs[0]).toContain('Long message:')
  expect(inputs[0]).not.toContain('end-long')
  expect(inputs[0].length).toBeLessThan(100_000)
  expect(inputs[1]).toContain('Reply after the long message.')
  expect(inputs[1]).not.toContain('Long message:')
})
