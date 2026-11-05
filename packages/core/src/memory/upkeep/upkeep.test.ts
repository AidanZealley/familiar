import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import type { TranscriptContext } from '@earendil-works/pi-ai'
import type { Storage } from '@earendil-works/pi-durable'
import { nextUpkeep, upkeepDay } from './schedule.ts'
import { afterEach, expect, test, vi } from 'vitest'
import { summonFamiliar, type Familiar } from '../../familiar.ts'
import { MemoryUsage } from '../facts.ts'
import { fakeClock, TEST_ZONE, timeAt } from '../../testing.ts'
import { readStored, ReopenableStorage, storageWith } from '../testing.ts'

const context = BACKGROUND_CONTEXT

const start = timeAt('2026-10-25 12:00')
const firstPass = nextUpkeep(start, TEST_ZONE)
const secondPass = nextUpkeep(firstPass, TEST_ZONE)

async function setup(storage: Storage = new ReopenableStorage()) {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const clock = fakeClock(start)

  const open = async () => {
    const familiar = await summonFamiliar({
      storage,
      models,
      model: { provider: 'faux', modelId: 'faux-1' },
      timeZone: TEST_ZONE,
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
    await familiar.send({
      author: { id: 'aidan', name: 'aidan' },
      text,
      // Each test message starts differently; a request ID has a bound.
      requestId: text.slice(0, 128),
    })
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

/** Dismisses a Familiar before the test ends, so its storage can be read. */
const dismiss = async (familiar: Familiar) => {
  opened.splice(opened.indexOf(familiar), 1)
  await familiar.dismiss()
}

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

/** The tool results sent back in one request. */
const toolResultsIn = (context: TranscriptContext) =>
  JSON.stringify(
    context.messages.filter((message) => message.role === 'toolResult'),
  )

/** The tools offered in one request. */
const toolsIn = (context: TranscriptContext) =>
  context.messages.flatMap((message) =>
    message.role === 'system' ? (message.toolsAdded ?? []) : [],
  )

const failed = () =>
  fauxAssistantMessage('', {
    stopReason: 'error',
    errorMessage: 'The model failed on purpose.',
  })

const DAY = 24 * 60 * 60 * 1000
const thirdPass = nextUpkeep(secondPass, TEST_ZONE)
const fourthPass = nextUpkeep(thirdPass, TEST_ZONE)
const fifthPass = nextUpkeep(fourthPass, TEST_ZONE)

test("upkeep days run 04:00 to 04:00 on the wall clock, in each Familiar's own zone", () => {
  {
    expect(upkeepDay(timeAt('2026-02-10 01:00'), TEST_ZONE)).toBe('2026-02-09')
    expect(upkeepDay(timeAt('2026-02-10 04:00'), TEST_ZONE)).toBe('2026-02-10')
  }
  {
    const HOUR = 60 * 60 * 1000
    // Clocks go forward an hour at 01:00 on 29 March 2026 in London, and back
    // at 02:00 on 25 October, so those upkeep days are 23 and 25 hours long.
    const spring = timeAt('2026-03-29 04:00')
    expect(nextUpkeep(timeAt('2026-03-28 04:00'), TEST_ZONE)).toBe(spring)
    expect(spring - timeAt('2026-03-28 04:00')).toBe(23 * HOUR)
    expect(upkeepDay(spring - 1, TEST_ZONE)).toBe('2026-03-28')
    expect(upkeepDay(timeAt('2026-03-29 04:30'), TEST_ZONE)).toBe('2026-03-29')

    const autumn = timeAt('2026-10-25 04:00')
    expect(nextUpkeep(timeAt('2026-10-24 04:00'), TEST_ZONE)).toBe(autumn)
    expect(autumn - timeAt('2026-10-24 04:00')).toBe(25 * HOUR)
    expect(upkeepDay(autumn - 1, TEST_ZONE)).toBe('2026-10-24')
    expect(upkeepDay(autumn, TEST_ZONE)).toBe('2026-10-25')
  }
  {
    const now = Date.UTC(2026, 5, 1, 12)
    expect(nextUpkeep(now, 'Europe/London')).toBe(Date.UTC(2026, 5, 2, 3))
    expect(nextUpkeep(now, 'America/New_York')).toBe(Date.UTC(2026, 5, 2, 8))
    // 12:00 UTC is already evening in Tokyo, and midnight in Auckland.
    expect(nextUpkeep(now, 'Asia/Tokyo')).toBe(Date.UTC(2026, 5, 1, 19))
    expect(nextUpkeep(now, 'Pacific/Auckland')).toBe(Date.UTC(2026, 5, 1, 16))
  }
})

test("a night files the day's facts from people's messages, reports refused edits to the model, writes its episode and rolls up the week", async () => {
  const { faux, familiar, say, memory, episodes, passAt } = await setup(
    await storageWith(
      ['Has a cat', 3],
      ['Owns a cat called Miso', 3],
      // Minor, so outside core: only recall can show it to the pass.
      ['Prefers green tea', 1],
    ),
  )
  // Sunday 25 October 2026; the first pass is Monday at 04:00.
  const people = [
    {
      author: { id: 'aidan', name: 'aidan' },
      text: 'I have a cat called Miso, and I am vegetarian.',
    },
    {
      author: { id: 'aidan', name: 'aidan' },
      text: 'I have switched to black tea now.',
    },
    // The same name is two people; a renamed person is still one.
    {
      author: { id: 'sam-1', name: 'Sam' },
      text: 'My favourite fruit is mango',
    },
    {
      author: { id: 'sam-2', name: 'Sam' },
      text: 'My favourite fruit is pear',
    },
    { author: { id: 'sam-1', name: 'Samuel' }, text: 'I still prefer mango' },
  ]
  faux.setResponses(people.map(() => fauxAssistantMessage('Noted.')))
  for (const message of people) {
    await familiar().send({ ...message, requestId: message.text })
    await familiar().idle()
  }
  const view = await familiar().watch()
  await view.stop()
  const reply = view.value.entries.find(
    (entry) => entry.kind === 'pi.assistant',
  )!

  let input = ''
  let recalled = ''
  let results = ''
  let rollup: TranscriptContext | undefined
  faux.setResponses([
    (context) => {
      expect(isUpkeep(context)).toBe(true)
      input = inputOf(context)
      recalled = JSON.stringify(context.messages.at(-1))
      const vegetarian = exchangeIn(input, 'vegetarian')
      return fauxAssistantMessage(
        [
          fauxToolCall('revise_memory', {
            id: 'f2',
            text: 'Owns a cat called Miso',
            sources: [vegetarian],
            merge: ['f1'],
          }),
          fauxToolCall('remember', {
            text: 'Is vegetarian',
            importance: 4,
            sources: [vegetarian],
          }),
          fauxToolCall('revise_memory', {
            id: 'f3',
            text: 'Prefers black tea',
            sources: [exchangeIn(input, 'black tea')],
          }),
          fauxToolCall('recall', { query: 'fruit' }),
          // Each refused: a reply, a message that doesn't exist, a missing
          // fact, and a change with nothing to say when it happened.
          fauxToolCall('remember', {
            text: 'Is vegetarian',
            importance: 4,
            sources: [`x${reply.id}`],
          }),
          fauxToolCall('remember', {
            text: 'Is vegetarian',
            importance: 4,
            sources: ['x9999'],
          }),
          fauxToolCall('retire', { id: 'f9', until: '2026-10-25' }),
          fauxToolCall('revise_memory', { id: 'f9', text: 'Lives in York' }),
        ],
        { stopReason: 'toolUse' },
      )
    },
    (context) => {
      results = toolResultsIn(context)
      return fauxAssistantMessage(
        'Aidan talked about Miso and tea; the two Sams compared fruit.',
      )
    },
    (context) => {
      rollup = context
      return fauxAssistantMessage('A week of cats, tea and fruit.')
    },
  ])
  await passAt(firstPass, secondPass)

  // Upkeep reads the stored words with their exchange IDs and authors, not
  // the model's copy with its author line.
  expect(input).toMatch(
    /\[x\d+ 2026-10-25 12:00\] \{"id":"aidan","name":"aidan"\}: I have a cat called Miso/,
  )
  expect(input).toContain('Familiar: Noted.')
  expect(input).not.toContain('[Message from')
  for (const { author, text } of people.slice(2)) {
    expect(input).toContain(`${JSON.stringify(author)}: ${text}`)
  }
  // Automatic recall shows the pass the fact outside core.
  expect(recalled).toContain('f3 (since')
  expect(results).toContain('sam-1')
  expect(results).toContain('sam-2')
  expect(results).toContain(`x${reply.id} is not a message from a person`)
  expect(results).toContain('x9999 is not a message from a person')
  expect(results).toContain('No fact f9')
  expect(results).toContain('Give since, or cite the messages')

  // Merged and revised versions stay as history, out of core.
  const vegetarian = Number(exchangeIn(input, 'vegetarian').slice(1))
  expect(await memory()).toMatchObject([
    { id: 'f1', until: '2026-10-25', core: false },
    { id: 'f2', until: '2026-10-25', core: false },
    { id: 'f3', until: '2026-10-25', core: false },
    {
      id: 'f4',
      text: 'Owns a cat called Miso',
      replaces: ['f2', 'f1'],
      sources: [vegetarian],
      since: '2026-10-25',
    },
    {
      id: 'f5',
      text: 'Is vegetarian',
      sources: [vegetarian],
      since: '2026-10-25',
    },
    {
      id: 'f6',
      text: 'Prefers black tea',
      replaces: ['f3'],
      since: '2026-10-25',
    },
  ])

  expect(await episodes()).toMatchObject([
    { id: 'e1', span: 'day', start: '2026-10-25', end: '2026-10-25' },
    { id: 'e2', span: 'week', start: '2026-10-19', end: '2026-10-25' },
  ])
  // Rolled up in its own conversation, with no tools to change facts.
  expect(JSON.stringify(rollup!.messages)).toContain(
    'You write the episodes of Familiar',
  )
  expect(toolsIn(rollup!)).toEqual([])
  expect(inputOf(rollup!)).toContain('The week of 2026-10-19 to 2026-10-25:')
  expect(inputOf(rollup!)).toContain(
    '2026-10-25: Aidan talked about Miso and tea',
  )

  // The week is rolled up, so it stands in for its day.
  let note = ''
  faux.setResponses([
    (context) => {
      note = JSON.stringify(context.messages.at(-1))
      return fauxAssistantMessage('Mango and pear.')
    },
  ])
  await say('What did the Sams say about fruit?')
  expect(note).toContain('e2 (week of 2026-10-19 to 2026-10-25)')
  expect(note).not.toContain('e1 (day')
})

test('each night reviews only what is new, dates a fact from its earliest source, and asks once for a missing episode', async () => {
  const { faux, say, memory, episodes, passAt } = await setup()
  faux.setResponses([fauxAssistantMessage('Lovely.')])
  await say('I started learning the cello today.')

  // Night one ends without its episode, so it is asked once more.
  let first = ''
  let followUp = ''
  faux.setResponses([
    (context) => {
      first = exchangeIn(inputOf(context), 'cello')
      return fauxAssistantMessage('')
    },
    (context) => {
      followUp = inputOf(context)
      return fauxAssistantMessage('Started the cello.')
    },
    fauxAssistantMessage('A week of cello.'),
  ])
  await passAt(firstPass, secondPass)
  expect(followUp).toBe(
    'Now reply with only the episode for that conversation.',
  )

  // Night two cites both days, and still writes no episode, so it moves on.
  faux.setResponses([fauxAssistantMessage('Good habit.')])
  await say('I practise the cello every evening now.')
  let second = ''
  faux.setResponses([
    (context) => {
      second = JSON.stringify(context.messages)
      return fauxAssistantMessage(
        fauxToolCall('remember', {
          text: 'Plays the cello, practising every evening',
          importance: 3,
          sources: [exchangeIn(inputOf(context), 'every evening'), first],
        }),
        { stopReason: 'toolUse' },
      )
    },
    fauxAssistantMessage(''),
    fauxAssistantMessage(''),
  ])
  await passAt(secondPass, thirdPass)
  // Nothing from the night before, in its input or left in the conversation.
  expect(second).not.toContain('learning the cello today')
  expect(await memory()).toMatchObject([
    {
      since: '2026-10-25',
      sources: [expect.any(Number), Number(first.slice(1))],
    },
  ])

  faux.setResponses([fauxAssistantMessage('Tidy.')])
  await say('I tidied the shed.')
  let third = ''
  faux.setResponses([
    (context) => {
      third = inputOf(context)
      return fauxAssistantMessage('Tidied the shed.')
    },
  ])
  await passAt(thirdPass, fourthPass)
  expect(third).toContain('tidied the shed')
  expect(third).not.toContain('every evening')
  expect((await episodes()).map(({ span, text }) => [span, text])).toEqual([
    ['day', 'Started the cello.'],
    ['week', 'A week of cello.'],
    ['day', 'Tidied the shed.'],
  ])

  // Nothing new was said, so nothing runs.
  const calls = faux.state.callCount
  await passAt(fourthPass, fifthPass)
  expect(faux.state.callCount).toBe(calls)
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

test('a busy day is reviewed in ordered batches, keeping progress across a failure and a restart, before its rollup', async () => {
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
  const batch = (episode: string) => (context: TranscriptContext) => {
    inputs.push(inputOf(context))
    return fauxAssistantMessage(episode)
  }
  faux.setResponses([batch('Batch 1.'), failed])
  await passAt(firstPass, secondPass)
  expect((await episodes()).map(({ span, text }) => [span, text])).toEqual([
    ['day', 'Batch 1.'],
  ])

  await reopen()
  let rollup = ''
  faux.setResponses([
    batch('Batch 2.'),
    (context) => {
      rollup = inputOf(context)
      return fauxAssistantMessage('Both batches.')
    },
  ])
  await passAt(secondPass, thirdPass)
  // The failed batch is retried, and only it.
  expect(inputs).toHaveLength(2)
  expect(inputs[0]).toContain(messages[0])
  expect(inputs[0]).toContain('First reply.')
  expect(inputs[0]).not.toContain('end-second')
  expect(inputs[1]).toContain(messages[1])
  expect(inputs[1]).toContain('Second reply.')
  expect(inputs[1]).not.toContain('end-first')
  expect(rollup).toContain('Batch 1.')
  expect(rollup).toContain('Batch 2.')
  expect(
    (await episodes()).map(({ span, start, end }) => [span, start, end]),
  ).toEqual([
    ['day', '2026-10-25', '2026-10-25'],
    ['day', '2026-10-25', '2026-10-25'],
    ['week', '2026-10-19', '2026-10-25'],
  ])

  const calls = faux.state.callCount
  await passAt(thirdPass, fourthPass)
  expect(faux.state.callCount).toBe(calls)
})

test('a backlog is reviewed a day at a time, an oversized message bounded alone, before the rollup of finished days', async () => {
  const { faux, say, setTime, episodes, passAt } = await setup()
  faux.setResponses([fauxAssistantMessage('Reply after the long message.')])
  await say(`Long message: ${'detail '.repeat(17_000)} end-long`)
  // The first night fails, so Sunday is still waiting when Monday's chat comes.
  faux.setResponses([failed])
  await passAt(firstPass, secondPass)
  setTime(firstPass + 60 * 60 * 1000)
  faux.setResponses([fauxAssistantMessage('Monday reply.')])
  await say('Monday news.')

  const inputs: string[] = []
  const batch = (context: TranscriptContext) => {
    inputs.push(inputOf(context))
    return fauxAssistantMessage(`Batch ${inputs.length}.`)
  }
  let rollup = ''
  faux.setResponses([
    batch,
    batch,
    batch,
    (context) => {
      rollup = inputOf(context)
      return fauxAssistantMessage('Sunday week.')
    },
  ])
  await passAt(secondPass, thirdPass)
  expect(inputs).toHaveLength(3)
  expect(inputs[0]).toContain('Long message:')
  expect(inputs[0]).not.toContain('end-long')
  expect(inputs[0].length).toBeLessThan(100_000)
  expect(inputs[1]).toContain('Reply after the long message.')
  expect(inputs[1]).not.toContain('Long message:')
  expect(inputs[2]).toContain('Monday news.')
  expect(inputs[2]).not.toContain('Reply after')
  expect(
    (await episodes())
      .filter(({ span }) => span === 'day')
      .map(({ start }) => start),
  ).toEqual(['2026-10-25', '2026-10-25', '2026-10-26'])
  // Only Sunday's week has ended.
  expect(rollup).toContain('Batch 2.')
  expect(rollup).not.toContain('Batch 3.')
})

test('after the backlog and rollups, a review rechecks the longest-unchecked facts, and a failed rollup or review is tried again the next night', async () => {
  const storage = await storageWith(
    ['Works at Northbank Ceramics', 4, start - 300 * DAY],
    ...Array.from(
      { length: 24 },
      (_, index) =>
        [`Minor detail ${index}`, 2, start - (200 - index) * DAY] as [
          string,
          number,
          number,
        ],
    ),
  )
  const { faux, familiar, say, memory, passAt } = await setup(storage)
  faux.setResponses([fauxAssistantMessage('Congratulations!')])
  await say('I started at Lantern Museum today and left Northbank.')

  const order: string[] = []
  const reviews: string[] = []
  faux.setResponses([
    () => {
      order.push('pass')
      // The pass files the day without noticing the old fact.
      return fauxAssistantMessage('Rowan left Northbank for Lantern Museum.')
    },
    () => {
      order.push('rollup')
      return failed()
    },
    (context) => {
      order.push('review')
      reviews.push(inputOf(context))
      return failed()
    },
  ])
  await passAt(firstPass, secondPass)
  // A failed rollup doesn't hold up the review; a failed review stamps nothing.
  expect(order).toEqual(['pass', 'rollup', 'review'])

  faux.setResponses([
    () => {
      order.push('rollup')
      return fauxAssistantMessage('A week of changing jobs.')
    },
    (context) => {
      order.push('review')
      reviews.push(inputOf(context))
      return fauxAssistantMessage(
        fauxToolCall('retire', { id: 'f1', until: '2026-10-25' }),
        { stopReason: 'toolUse' },
      )
    },
    fauxAssistantMessage('Checked.'),
  ])
  await passAt(secondPass, thirdPass)
  expect(order).toEqual(['pass', 'rollup', 'review', 'rollup', 'review'])
  // The same twenty, checked longest ago first, with the recent days.
  expect(reviews[1]).toBe(reviews[0])
  expect(reviews[1]).toMatch(
    /^Check these facts against what happened recently:\nf1 \(since 2026-01-05\): Works at Northbank Ceramics\nf2 /,
  )
  expect(reviews[1]).toContain('f20 ')
  expect(reviews[1]).not.toContain('f21 ')
  expect(reviews[1]).toContain(
    'e1 (day of 2026-10-25): Rowan left Northbank for Lantern Museum.',
  )
  expect((await memory())[0]).toMatchObject({ id: 'f1', until: '2026-10-25' })

  await dismiss(familiar())
  const { facts } = await readStored(storage, MemoryUsage)
  expect(Object.keys(facts)).toHaveLength(20)
  expect(facts.f20).toEqual({ checked: secondPass })
  expect(facts.f21).toBeUndefined()
})

test('a restart during the review neither submits it twice nor stamps more than it was given', async () => {
  const storage = await storageWith(
    ['Has a cat', 3, start - 90 * DAY],
    ['Likes blue pens', 1, start - 60 * DAY],
  )
  const { faux, familiar, say, passAt, reopen } = await setup(storage)
  faux.setResponses([fauxAssistantMessage('Hello.')])
  await say('Hi.')
  const reviews: string[][] = []
  const checks = (context: TranscriptContext) =>
    context.messages
      .map((message) => JSON.stringify(message))
      .filter((message) => message.includes('Check these facts'))
  let restarted: Promise<void> | undefined
  faux.setResponses([
    fauxAssistantMessage('Said hello.'),
    fauxAssistantMessage('A week of greetings.'),
    (context) => {
      reviews.push(checks(context))
      // The process stops while the review is being answered.
      restarted = reopen()
      return fauxAssistantMessage('Checked.')
    },
    (context) => {
      reviews.push(checks(context))
      return fauxAssistantMessage('Checked.')
    },
  ])
  await passAt(firstPass, secondPass)
  await restarted
  await vi.waitFor(async () => {
    const tasks = await storage.scanTasks(
      { kind: 'familiar.upkeep' },
      10,
      undefined,
      context,
    )
    expect(tasks.items[0]?.state).toMatchObject({ status: 'sleeping' })
  })
  // Answered again after the restart, but asked only once.
  expect(reviews).toEqual([[expect.any(String)], [expect.any(String)]])

  await dismiss(familiar())
  expect((await readStored(storage, MemoryUsage)).facts).toEqual({
    f1: { checked: firstPass },
    f2: { checked: firstPass },
  })
})
