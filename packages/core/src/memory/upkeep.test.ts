import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import type { TranscriptContext } from '@earendil-works/pi-ai'
import { MemoryStorage, type SetTimer } from '@earendil-works/pi-durable'
import { nextUpkeep } from './upkeep.ts'
import { afterEach, expect, test, vi } from 'vitest'
import { summonFamiliar, type Familiar } from '../familiar.ts'

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
    if (background) return undefined // only frees memory
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
    for (const timer of due) timer.fire()
  }
  return { now: () => now, setTimer, advanceTo }
}

const start = new Date(2026, 9, 25, 12).getTime() // local noon
const firstPass = nextUpkeep(start)
const secondPass = nextUpkeep(firstPass)

async function setup() {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const storage = new ReopenableStorage()
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
    say,
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

test('a pass at 04:00 consolidates memory with the memory tools', async () => {
  const { faux, say, memory, passAt } = await setup()
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall('remember', { text: 'Has a cat', importance: 3 }),
        fauxToolCall('remember', {
          text: 'Owns a cat called Miso',
          importance: 3,
        }),
      ],
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Noted.'),
  ])
  await say('I have a cat called Miso, and I am vegetarian.')

  let input = ''
  faux.setResponses([
    (context) => {
      expect(isUpkeep(context)).toBe(true)
      input = inputOf(context)
      return fauxAssistantMessage(
        [
          fauxToolCall('revise_memory', {
            id: 'm2',
            text: 'Owns a cat called Miso',
            merge: ['m1'],
          }),
          fauxToolCall('remember', { text: 'Is vegetarian', importance: 4 }),
        ],
        { stopReason: 'toolUse' },
      )
    },
    fauxAssistantMessage('Merged the cat facts and saved one.'),
  ])
  expect(faux.getPendingResponseCount()).toBe(2)
  await passAt(firstPass, secondPass)

  expect(faux.getPendingResponseCount()).toBe(0)
  expect(input).toContain('aidan: I have a cat called Miso')
  expect(input).toContain('Familiar: Noted.')
  // Merged duplicates stay as history; only current facts are believed.
  expect(
    (await memory())
      .filter((fact) => fact.until === undefined)
      .map((fact) => [fact.text, fact.replaces]),
  ).toEqual([
    ['Owns a cat called Miso', ['m2', 'm1']],
    ['Is vegetarian', undefined],
  ])
  expect(await memory()).toHaveLength(4)
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
  const { faux, say, memory, passAt } = await setup()
  const recalledIn = (context: TranscriptContext) =>
    JSON.stringify(context.messages).includes('m1 (since')
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('remember', { text: 'Prefers green tea', importance: 1 }),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Noted.'),
  ])
  await say('I prefer green tea.')
  expect((await memory())[0].core).toBe(false)

  faux.setResponses([
    fauxAssistantMessage('Nothing to change.'),
    fauxAssistantMessage('Noted.'),
  ])
  await passAt(firstPass, secondPass)
  await say('I have switched to black tea now.')

  let sawFact = false
  faux.setResponses([
    (context) => {
      expect(isUpkeep(context)).toBe(true)
      sawFact = recalledIn(context)
      return fauxAssistantMessage(
        fauxToolCall('revise_memory', { id: 'm1', text: 'Prefers black tea' }),
        { stopReason: 'toolUse' },
      )
    },
    fauxAssistantMessage('Revised the tea preference.'),
  ])
  await passAt(secondPass, nextUpkeep(secondPass))

  expect(sawFact).toBe(true)
  expect(
    (await memory()).filter((fact) => fact.until === undefined),
  ).toMatchObject([{ id: 'm2', text: 'Prefers black tea', replaces: ['m1'] }])
})

test('a pass can search for a fact its automatic recall missed', async () => {
  const { faux, say, memory, passAt } = await setup()
  const topics = Array.from(
    { length: 10 },
    (_, index) =>
      `Topic ${index}: switched to a new routine for the garden now`,
  )
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall('remember', { text: 'Prefers green tea', importance: 1 }),
        ...topics.map((text) =>
          fauxToolCall('remember', { text, importance: 1 }),
        ),
      ],
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Noted.'),
  ])
  await say('Lots about me.')
  faux.setResponses([
    fauxAssistantMessage('Nothing to change.'),
    fauxAssistantMessage('Noted.'),
  ])
  await passAt(firstPass, secondPass)
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
        fauxToolCall('revise_memory', { id: 'm1', text: 'Prefers black tea' }),
        { stopReason: 'toolUse' },
      )
    },
    fauxAssistantMessage('Revised the tea preference.'),
  ])
  await passAt(secondPass, nextUpkeep(secondPass))

  // Crowded out of the automatic eight, but found by a targeted search.
  expect(automatic).toContain('Recalled from memory')
  expect(automatic).not.toContain('green tea')
  expect(searched).toContain('m1 (since')
  expect(
    (await memory())
      .filter((fact) => fact.until === undefined)
      .map((fact) => fact.text),
  ).toContain('Prefers black tea')
})

test("a pass writes the day's episode, rebalances core, and Monday's pass rolls up the week", async () => {
  const { faux, say, memory, episodes, passAt } = await setup()
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('remember', {
        text: 'Plants bulbs with Noor',
        importance: 3,
      }),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Lovely.'),
  ])
  // Sunday 25 October 2026; the first pass is Monday at 04:00.
  await say('I spent today planting bulbs with Noor.')
  expect((await memory())[0].core).toBe(true)

  let rollupInput = ''
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('set_importance', { id: 'm1', importance: 1 }),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Rowan planted bulbs with Noor on Sunday.'),
    (context) => {
      expect(isUpkeep(context)).toBe(true)
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
  expect(rollupInput).toContain('week of 2026-10-19 to 2026-10-25')
  expect(rollupInput).toContain(
    '2026-10-25: Rowan planted bulbs with Noor on Sunday.',
  )
  // Rated down, so rebalancing moved it out of core; it is still kept.
  expect(await memory()).toMatchObject([{ id: 'm1', core: false }])

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
