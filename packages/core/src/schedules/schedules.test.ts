import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxResponseFactory,
} from '@earendil-works/pi-ai/providers/faux'
import type { AssistantMessage, TranscriptContext } from '@earendil-works/pi-ai'
import type { InboxState, Wake } from '@earendil-works/pi-durable'
import { afterEach, expect, test, vi } from 'vitest'
import { SCHEDULED_KIND } from '../conversation/index.ts'
import {
  summonFamiliar,
  type Familiar,
  type Notification,
} from '../familiar.ts'
import { ReopenableStorage, withHarness } from '../memory/testing.ts'
import { fakeClock, TEST_ZONE, timeAt } from '../testing.ts'
import { parseMinute } from '../time/index.ts'
import { latestOccurrence, nextOccurrence, repeatProblem } from './repeat.ts'
import { defineTool, Type, type Author, type FamiliarPlugin } from '../index.ts'
import {
  addSchedule,
  advance,
  DEFAULT_MAX_SCHEDULES,
  dueAt,
  SCHEDULE_LIMITS,
  Schedules,
  upcoming,
} from './schedules.ts'

const pad = (value: number) => String(value).padStart(2, '0')

/** A time in October 2026 in TEST_ZONE, where the clocks go back on the 25th. */
const at = (day: number, hour: number, minute = 0) =>
  timeAt(`2026-10-${pad(day)} ${pad(hour)}:${pad(minute)}`)

/** Wednesday 21 October 2026, local noon. */
const start = at(21, 12)

/** The input a request answers: its last user message, before any recall note. */
const inputOf = (context: TranscriptContext) =>
  context.messages
    .map((message) =>
      message.role !== 'user'
        ? ''
        : typeof message.content === 'string'
          ? message.content
          : message.content
              .map((part) => (part.type === 'text' ? part.text : ''))
              .join(''),
    )
    .findLast((text) => text && !text.startsWith('Recalled from memory')) ?? ''

/** How the model answers a scheduled input: a reply, or a scripted message. */
type Answer =
  | string
  | ((signal?: AbortSignal) => AssistantMessage | Promise<AssistantMessage>)

const opened: Familiar[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((familiar) => familiar.dismiss()))
})

async function setup(
  options: { onWake?: (wake: Wake) => void; plugins?: FamiliarPlugin[] } = {},
) {
  const storage = new ReopenableStorage()
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const clock = fakeClock(start)
  let timeZone = TEST_ZONE
  const notifications: Notification[] = []

  // Scheduled inputs take the next answer in turn, and the owner's messages
  // the answer given for them. Anything else, such as memory upkeep at
  // 04:00, hears there's nothing to do.
  const inputs: string[] = []
  const answers: Answer[] = []
  const ownerAnswers = new Map<string, Answer>()
  const respond: FauxResponseFactory = (context, options) => {
    // Owners' messages by their words, without the line naming them.
    const input = inputOf(context).replace(/^\[Message from .*\n/, '')
    let next: Answer
    if (input.startsWith('[Scheduled')) {
      inputs.push(input)
      next = answers.shift() ?? 'Done.'
    } else {
      next = ownerAnswers.get(input) ?? 'Nothing new.'
    }
    return typeof next === 'string'
      ? fauxAssistantMessage(next)
      : next(options?.signal)
  }

  const open = async () => {
    const familiar = await summonFamiliar({
      storage,
      models,
      model: { provider: 'faux', modelId: 'faux-1' },
      timeZone,
      now: clock.now,
      setTimer: clock.setTimer,
      notify: async (notification) => {
        notifications.push(notification)
      },
      onWake: options.onWake,
      plugins: options.plugins,
    })
    opened.push(familiar)
    return familiar
  }
  let familiar = await open()

  /** Asks for a reminder, as the model would, and returns its ID. */
  const schedule = async (
    args: { at?: string; repeat?: string },
    author: Author = { id: 'aidan', name: 'aidan' },
  ) => {
    let result = ''
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('schedule', {
          prompt: 'Remind Aidan to call Mum',
          ...args,
        }),
        { stopReason: 'toolUse' },
      ),
      (context) => {
        result = JSON.stringify(context.messages.at(-1))
        return fauxAssistantMessage('Will do.')
      },
      ...Array.from({ length: 100 }, () => respond),
    ])
    await familiar.send({
      author,
      text: 'Remind me to call Mum',
      requestId: `ask:${clock.now()}`,
    })
    await familiar.idle()
    const id = /Scheduled (s\d+)/.exec(result)?.[1]
    expect(id, result).toBeDefined()
    return id!
  }

  const schedules = async () => {
    const watch = await familiar.schedules.watch()
    await watch.stop()
    return watch.value ?? {}
  }

  const scheduledEntries = async () => {
    const watch = await familiar.watch()
    await watch.stop()
    return watch.value.entries.filter((entry) => entry.kind === SCHEDULED_KIND)
  }

  /** Waits until the schedule's task sleeps until `time`, or has finished. */
  const sleepingUntil = (time: number | 'done') =>
    vi.waitFor(async () => {
      const [task] = (
        await storage.scanTasks(
          { kind: 'familiar.schedule' },
          1,
          undefined,
          BACKGROUND_CONTEXT,
        )
      ).items
      expect(task?.state).toMatchObject(
        time === 'done'
          ? { status: 'terminal' }
          : { status: 'sleeping', until: time },
      )
    })

  /** Moves the clock to `time`, then waits for the task to settle at `next`. */
  const fireAt = async (time: number, next: number | 'done') => {
    clock.advanceTo(time)
    await sleepingUntil(next)
  }

  /**
   * Closes Familiar and opens it again, at `time` and in `zone` if given,
   * after `meanwhile` changes its storage, as an older version might have.
   */
  const reopen = async (
    time?: number,
    zone?: string,
    meanwhile?: () => Promise<void>,
  ) => {
    opened.splice(opened.indexOf(familiar), 1)
    await familiar.dismiss()
    await meanwhile?.()
    if (time !== undefined) {
      clock.setTime(time)
    }
    timeZone = zone ?? timeZone
    familiar = await open()
  }

  return {
    familiar: () => familiar,
    storage,
    clock,
    inputs,
    answer: (...next: Answer[]) => answers.push(...next),
    /** Sends a message from the owner, which the model answers with `answer`. */
    say: (text: string, answer: Answer) => {
      ownerAnswers.set(text, answer)
      return familiar.send({
        author: { id: 'aidan', name: 'aidan' },
        text,
        requestId: text,
      })
    },
    notifications,
    schedule,
    schedules,
    scheduledEntries,
    sleepingUntil,
    fireAt,
    reopen,
  }
}

const bodies = (notifications: Notification[]) =>
  notifications.map(({ body }) => body)

const HOUR = 60 * 60 * 1000

/** A repeat's first `count` times, as a schedule added at `created` has them. */
const upcomingFrom = (
  repeat: string,
  created: number,
  count: number,
  timeZone = TEST_ZONE,
) =>
  upcoming(
    addSchedule(
      {},
      { id: 's1', prompt: 'Stretch', repeat },
      created,
      timeZone,
      DEFAULT_MAX_SCHEDULES,
    ),
    count,
    timeZone,
  )

test('a one-off reminder runs at its time, notifies with the reply, and is removed', async () => {
  const f = await setup()
  const id = await f.schedule({ at: '2026-10-21 18:00' })
  expect(Object.keys(await f.schedules())).toEqual([id])
  expect((await f.schedules())[id].creator).toEqual({
    id: 'aidan',
    name: 'aidan',
  })

  f.answer('**Time to call Mum!**')
  await f.fireAt(at(21, 18), 'done')

  expect(f.inputs).toEqual([
    '[Scheduled for 2026-10-21 18:00; requested by {"id":"aidan","name":"aidan"}] Remind Aidan to call Mum',
  ])
  expect(f.notifications).toEqual([
    { title: 'Familiar', body: 'Time to call Mum!', url: '/' },
  ])
  expect(await f.schedules()).toEqual({})
  expect((await f.scheduledEntries()).map((entry) => entry.data)).toEqual([
    {
      scheduleId: id,
      prompt: 'Remind Aidan to call Mum',
      due: at(21, 18),
      creator: { id: 'aidan', name: 'aidan' },
    },
  ])
})

test('with onWake, a reminder arms no timer and runs when the host resumes', async () => {
  const wakes: Wake[] = []
  const f = await setup({ onWake: (wake) => wakes.push(wake) })
  // Told once open, before any work, so the host can arm its wakeup.
  expect(wakes.length).toBeGreaterThan(0)
  await f.schedule({ at: '2026-10-21 18:00' })
  await vi.waitFor(() =>
    expect(wakes.at(-1)).toEqual({ active: false, at: at(21, 18) }),
  )
  expect(f.familiar().wake()).toEqual({ active: false, at: at(21, 18) })

  f.answer('**Time to call Mum!**')
  f.clock.advanceTo(at(21, 18))
  await new Promise((resolve) => setTimeout(resolve, 50))
  await f.sleepingUntil(at(21, 18))
  expect(f.notifications).toEqual([])

  f.familiar().resume()
  await f.sleepingUntil('done')
  await vi.waitFor(() =>
    expect(bodies(f.notifications)).toEqual(['Time to call Mum!']),
  )
  // Next is upkeep's 04:00 pass.
  await vi.waitFor(() =>
    expect(f.familiar().wake()).toEqual({ active: false, at: at(22, 4) }),
  )
})

test('a failed run notifies with the prompt', async () => {
  const f = await setup()
  await f.schedule({ at: '2026-10-21 18:00' })
  f.answer(() =>
    fauxAssistantMessage('', {
      stopReason: 'error',
      errorMessage: 'The model failed on purpose.',
    }),
  )
  await f.fireAt(at(21, 18), 'done')
  expect(bodies(f.notifications)).toEqual(['Remind Aidan to call Mum'])
})

test('a reminder queued behind a failed run still runs', async () => {
  const f = await setup()
  await f.schedule({ at: '2026-10-21 18:00' })

  // The owner's run is still waiting on the model when the reminder is due.
  let fail!: () => void
  const failing = new Promise<void>((resolve) => (fail = resolve))
  await f.say('Hello', async () => {
    await failing
    return fauxAssistantMessage('', {
      stopReason: 'error',
      errorMessage: 'Usage limit reached.',
    })
  })
  f.answer('Call Mum.')
  f.clock.advanceTo(at(21, 18))
  await vi.waitFor(async () => {
    const watch = await f.familiar().watch()
    await watch.stop()
    const inbox = watch.value.docs['pi.inbox'] as InboxState | undefined
    expect(inbox?.items).toHaveLength(1)
  })
  fail()

  await f.sleepingUntil('done')
  expect(bodies(f.notifications)).toEqual(['Call Mum.'])
})

test('cancelling before the time means no input and no notification', async () => {
  const f = await setup()
  const id = await f.schedule({ at: '2026-10-21 18:00' })
  await f.familiar().schedules.cancel(id)
  await expect(f.familiar().schedules.cancel(id)).rejects.toThrow(
    `No schedule ${id}.`,
  )
  await f.fireAt(at(21, 18), 'done')
  expect(f.notifications).toEqual([])
  expect(await f.scheduledEntries()).toEqual([])
})

test('reopening while waiting for the reply submits once and notifies once', async () => {
  const f = await setup()
  await f.schedule({ at: '2026-10-21 18:00' })

  // The first reply is still on its way when Familiar closes; the next
  // process asks again and gets one.
  let asked!: () => void
  const asking = new Promise<void>((resolve) => (asked = resolve))
  f.answer((signal) => {
    asked()
    return new Promise((_, reject) =>
      signal?.addEventListener('abort', () => reject(signal.reason)),
    )
  }, 'Call Mum.')
  f.clock.advanceTo(at(21, 18))
  await asking
  await f.reopen()

  await f.sleepingUntil('done')
  expect(bodies(f.notifications)).toEqual(['Call Mum.'])
  expect(await f.scheduledEntries()).toHaveLength(1)
})

test('a daily repeat woken three days late delivers once, marked late, and continues tomorrow', async () => {
  const f = await setup()
  const id = await f.schedule({ repeat: '0 18 * * *' })
  await f.sleepingUntil(at(21, 18))

  // Down from before Wednesday's run until Saturday evening.
  f.answer('Call Mum.')
  await f.reopen(at(24, 21, 14))
  await f.sleepingUntil(at(25, 18))

  expect(f.inputs).toEqual([
    '[Scheduled for 2026-10-24 18:00, delivered 2026-10-24 21:14; requested by {"id":"aidan","name":"aidan"}] Remind Aidan to call Mum',
  ])
  expect(f.notifications).toHaveLength(1)
  expect((await f.schedules())[id].next).toBe(at(25, 18))
})

test('a repeat keeps its local time across a daylight saving change', async () => {
  // The clocks go back at 02:00 on Sunday 25 October, so that day is 25 hours.
  expect(at(25, 7) - at(24, 7)).toBe(25 * 60 * 60 * 1000)
  const daily = '0 7 * * *'
  expect(nextOccurrence(daily, at(24, 8), TEST_ZONE)).toBe(at(25, 7))

  const f = await setup()
  await f.schedule({ repeat: daily })
  await f.sleepingUntil(at(22, 7))
  for (const day of [22, 23, 24, 25, 26]) {
    await f.fireAt(at(day, 7), at(day + 1, 7))
  }
  expect(f.inputs).toEqual(
    [22, 23, 24, 25, 26].map(
      (day) =>
        `[Scheduled for 2026-10-${day} 07:00; requested by {"id":"aidan","name":"aidan"}] Remind Aidan to call Mum`,
    ),
  )
})

test('a one-off at a minute that does not exist is refused', () => {
  // Dates roll over in JavaScript, so only an exact round trip is accepted.
  expect(() =>
    addSchedule(
      {},
      { id: 's1', prompt: 'Stretch', at: '2026-02-30 09:00' },
      start,
      TEST_ZONE,
      DEFAULT_MAX_SCHEDULES,
    ),
  ).toThrow('that exists')
})

test('a minute the clock skips is refused, and one it shows twice is the first', () => {
  // London's clocks go forward from 01:00 to 02:00 on 29 March 2026.
  expect(parseMinute('2026-03-29 01:30', TEST_ZONE)).toBeUndefined()
  expect(() =>
    addSchedule(
      {},
      { id: 's1', prompt: 'Stretch', at: '2026-03-29 01:30' },
      Date.UTC(2026, 2, 1),
      TEST_ZONE,
      DEFAULT_MAX_SCHEDULES,
    ),
  ).toThrow('that exists in Europe/London')
  // They go back from 02:00 to 01:00 on 25 October, so 01:30 happens twice.
  expect(parseMinute('2026-10-25 01:30', TEST_ZONE)).toBe(
    Date.UTC(2026, 9, 25, 0, 30),
  )
  expect(parseMinute('2026-10-25 01:30', 'Asia/Tokyo')).toBe(
    Date.UTC(2026, 9, 24, 16, 30),
  )
  expect(parseMinute('2026-10-25 1:30', TEST_ZONE)).toBeUndefined()
})

test('a repeat at a time the clock skips runs when the clock resumes', () => {
  // London's clocks go forward from 01:00 to 02:00 on 29 March 2026, so
  // 01:30 doesn't happen that day; Croner runs it at 02:00.
  const daily = '30 1 * * *'
  const created = timeAt('2026-03-27 12:00')
  expect(upcomingFrom(daily, created, 3)).toEqual([
    timeAt('2026-03-28 01:30'),
    timeAt('2026-03-29 02:00'),
    timeAt('2026-03-30 01:30'),
  ])
  const after = timeAt('2026-03-29 02:10')
  expect(nextOccurrence(daily, after, TEST_ZONE)).toBe(
    timeAt('2026-03-30 01:30'),
  )
  expect(latestOccurrence(daily, after, TEST_ZONE)).toBe(
    timeAt('2026-03-29 02:00'),
  )
})

test('an hourly repeat runs once an hour, in order, as the clocks go back', () => {
  const hourly = '30 * * * *'
  const created = Date.UTC(2026, 9, 24, 22)
  const times = upcomingFrom(hourly, created, 5)
  // 01:30 is shown twice that night, an hour apart, and an hourly repeat
  // runs at both.
  expect(times.map((time) => new Date(time).toISOString())).toEqual([
    '2026-10-24T22:30:00.000Z',
    '2026-10-24T23:30:00.000Z',
    '2026-10-25T00:30:00.000Z',
    '2026-10-25T01:30:00.000Z',
    '2026-10-25T02:30:00.000Z',
  ])
  const repeated = Date.UTC(2026, 9, 25, 1, 40)
  expect(nextOccurrence(hourly, repeated, TEST_ZONE)).toBe(
    Date.UTC(2026, 9, 25, 2, 30),
  )
  expect(latestOccurrence(hourly, repeated, TEST_ZONE)).toBe(
    Date.UTC(2026, 9, 25, 1, 30),
  )
  // A daily repeat at 01:30 runs that night only at the first.
  expect(upcomingFrom('30 1 * * *', created, 3)).toEqual([
    Date.UTC(2026, 9, 25, 0, 30),
    Date.UTC(2026, 9, 26, 1, 30),
    Date.UTC(2026, 9, 27, 1, 30),
  ])
})

test("one repeat runs at 07:00 in each Familiar's own zone", () => {
  const daily = '0 7 * * *'
  const now = Date.UTC(2026, 5, 1, 12)
  expect(nextOccurrence(daily, now, 'Asia/Tokyo')).toBe(
    Date.UTC(2026, 5, 1, 22),
  )
  expect(nextOccurrence(daily, now, 'America/New_York')).toBe(
    Date.UTC(2026, 5, 2, 11),
  )
})

test('an occurrence exactly at a time is the latest by then, not the next after it', () => {
  const daily = '0 18 * * *'
  expect(latestOccurrence(daily, at(24, 18), TEST_ZONE)).toBe(at(24, 18))
  expect(latestOccurrence(daily, at(24, 18) - 500, TEST_ZONE)).toBe(at(23, 18))
  expect(nextOccurrence(daily, at(24, 18), TEST_ZONE)).toBe(at(25, 18))
  expect(nextOccurrence(daily, at(24, 18) - 500, TEST_ZONE)).toBe(at(24, 18))

  // Missed since Wednesday, it's due at the latest occurrence, Saturday's.
  const schedule = addSchedule(
    {},
    { id: 's1', prompt: 'Stretch', repeat: daily },
    start,
    TEST_ZONE,
    DEFAULT_MAX_SCHEDULES,
  )
  expect(schedule.next).toBe(at(21, 18))
  expect(dueAt(schedule, at(24, 18), TEST_ZONE)).toBe(at(24, 18))
  expect(dueAt(schedule, at(24, 18) - 500, TEST_ZONE)).toBe(at(23, 18))
  // Woken just before its first time, it's still that time.
  expect(dueAt(schedule, at(21, 17, 59), TEST_ZONE)).toBe(at(21, 18))
})

test('a weekday repeat previews its next times, skipping the weekend', () => {
  // Wednesday noon: Thursday, Friday, then Monday at 07:00.
  expect(upcomingFrom('0 7 * * 1-5', start, 3)).toEqual([
    at(22, 7),
    at(23, 7),
    at(26, 7),
  ])
})

test('reopened in another zone, a one-off keeps its time and a repeat follows the new zone', async () => {
  const f = await setup()
  const once = await f.schedule({ at: '2026-10-22 09:00' })
  f.clock.advanceTo(at(21, 12, 1))
  const daily = await f.schedule({ repeat: '0 7 * * *' })
  expect((await f.schedules())[daily].next).toBe(at(22, 7))

  // The owner moves to New York, five hours behind London that week.
  await f.reopen(at(21, 13), 'America/New_York')
  const stored = await f.schedules()
  expect(stored[once].next).toBe(at(22, 9))
  // The occurrence already set keeps its time; the next follows New York.
  expect(stored[daily].next).toBe(at(22, 7))
  f.clock.advanceTo(at(22, 7))
  await vi.waitFor(async () =>
    expect((await f.schedules())[daily].next).toBe(Date.UTC(2026, 9, 22, 11)),
  )
  expect(f.inputs).toEqual([
    '[Scheduled for 2026-10-22 02:00; requested by {"id":"aidan","name":"aidan"}] Remind Aidan to call Mum',
  ])
})

test('a reopened schedule exposes its creator snapshot to tools without recipient routing', async () => {
  const seen: (Author | undefined)[] = []
  const f = await setup({
    plugins: [
      {
        name: 'identity',
        title: 'Identity',
        extension: () => ({
          tools: [
            defineTool({
              name: 'identify',
              description: 'Report the creator',
              parameters: Type.Object({}),
              execute: async (_args, api) => {
                seen.push(api.author)
                return { output: [{ type: 'text', text: 'Identified' }] }
              },
            }),
          ],
        }),
      },
    ],
  })
  const author = { id: 'sam-1', name: 'Sam' }
  const id = await f.schedule({ at: '2026-10-21 18:00' }, author)
  author.name = 'Samuel'
  await f.reopen()
  expect((await f.schedules())[id].creator).toEqual({
    id: 'sam-1',
    name: 'Sam',
  })
  f.answer(
    () =>
      fauxAssistantMessage(fauxToolCall('identify', {}), {
        stopReason: 'toolUse',
      }),
    'Time to call Mum',
  )
  await f.fireAt(at(21, 18), 'done')
  expect(seen).toEqual([{ id: 'sam-1', name: 'Sam' }])
  expect(bodies(f.notifications)).toEqual(['Time to call Mum'])
})

test.each([
  // Repeats saved before repeats were cron.
  'FREQ=DAILY;BYHOUR=7;BYMINUTE=0',
  'RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0',
  // Not five fields.
  'not a repeat',
  '0 7 * *',
  '0 0 7 * * *',
  // Fields Croner can't read.
  '*/0 * * * *',
  '60 * * * *',
  '0 24 * * *',
  '0 7 32 * *',
  '0 7 * 13 *',
  '0 7 * * 8',
])('a repeat that is not five-field cron is refused: %s', (repeat) => {
  const problem = repeatProblem(repeat, TEST_ZONE)
  expect(problem).toContain('five-field cron')
  expect(() =>
    addSchedule(
      {},
      { id: 's1', prompt: 'Stretch', repeat },
      start,
      TEST_ZONE,
      DEFAULT_MAX_SCHEDULES,
    ),
  ).toThrow(problem)
})

test('a repeat that never happens is refused', () => {
  expect(repeatProblem('0 9 31 2 *', TEST_ZONE)).toBeUndefined()
  expect(() =>
    addSchedule(
      {},
      { id: 's1', prompt: 'Stretch', repeat: '0 9 31 2 *' },
      start,
      TEST_ZONE,
      DEFAULT_MAX_SCHEDULES,
    ),
  ).toThrow('never happens')
})

// Each is timed as it's worked out. A test timeout can't interrupt
// synchronous work, so a repeat that never finished would stall the run
// rather than fail it; the bound catches one that is merely slow.
test('malformed, impossible and rare repeats are each worked out promptly', () => {
  const malformed = [
    'FREQ=HOURLY;BYMINUTE=0;INTERVAL=-1',
    '',
    '*/-1 * * * *',
    '1/0 * * * *',
    '0-61 * * * *',
    '0 0 0 * *',
    `0 7 * * ${'1,'.repeat(130)}1`,
    'x'.repeat(SCHEDULE_LIMITS.repeat + 1),
  ]
  const never = ['0 0 31 2 *', '0 0 30 2 *', '0 0 31 4,6,9,11 *']
  const rare = ['0 9 29 2 *', '0 9 L 2 *', '0 9 * 2 1#5', '0 9 * * 5#5']
  const results = [...malformed, ...never, ...rare].map((repeat) => {
    const began = performance.now()
    const problem = repeatProblem(repeat, TEST_ZONE)
    const next = problem ? undefined : nextOccurrence(repeat, start, TEST_ZONE)
    const latest = problem
      ? undefined
      : latestOccurrence(repeat, start, TEST_ZONE)
    return { repeat, problem, next, latest, ms: performance.now() - began }
  })
  const of = (repeats: string[]) =>
    results.filter(({ repeat }) => repeats.includes(repeat))
  for (const result of results) {
    expect(result.ms, result.repeat).toBeLessThan(2_000)
  }
  for (const { repeat, problem } of of(malformed)) {
    expect(problem, repeat).toBeDefined()
  }
  for (const { repeat, problem, next, latest } of of(never)) {
    expect({ problem, next, latest }, repeat).toEqual({})
  }
  for (const { repeat, problem, next } of of(rare)) {
    expect(problem, repeat).toBeUndefined()
    expect(next, repeat).toBeGreaterThan(start)
  }
})

test.each([
  '30 * * * *',
  '0 */2 * * *',
  '45 7,8,9,22,23 * * *',
  '0 7 * * 1-5',
  // Asking for more often than hourly is spaced out to hourly.
  '*/5 * * * *',
  '* * * * *',
  '0,30 7 * * *',
])('a repeat is at least an hour apart, across clock changes: %s', (repeat) => {
  // Through both of 2026's clock changes in TEST_ZONE.
  for (const from of [timeAt('2026-03-27 00:00'), at(23, 0)]) {
    const times = upcomingFrom(repeat, from, 120)
    for (const [i, time] of times.slice(1).entries()) {
      expect(time - times[i]).toBeGreaterThanOrEqual(HOUR)
    }
  }
})

test('a repeat more often than hourly previews and runs its spaced times', () => {
  expect(upcomingFrom('*/5 * * * *', start, 3)).toEqual([
    at(21, 12, 5),
    at(21, 13, 5),
    at(21, 14, 5),
  ])
  const schedules = {
    s1: {
      id: 's1',
      prompt: 'Stretch',
      repeat: '*/5 * * * *',
      created: start,
      next: at(21, 12, 5),
    },
  }
  // Delivered late, at 12:40, it still waits an hour from 12:05.
  expect(
    advance(schedules, 's1', at(21, 12, 5), at(21, 12, 40), TEST_ZONE)?.next,
  ).toBe(at(21, 13, 5))
})

test('a half-hour clock change never brings an hourly repeat within an hour', () => {
  // Lord Howe Island's clocks go back half an hour at 02:00 on 5 April 2026,
  // so 01:30 happens twice, half an hour apart, and Croner has both.
  const zone = 'Australia/Lord_Howe'
  const hourly = '30 * * * *'
  const first = Date.parse('2026-04-04T14:30:00Z')
  expect(nextOccurrence(hourly, first, zone)).toBe(
    Date.parse('2026-04-04T15:00:00Z'),
  )

  // Familiar skips the second 01:30, half an hour after the first.
  const created = Date.parse('2026-04-04T13:00:00Z')
  const times = upcomingFrom(hourly, created, 4, zone)
  expect(times.map((time) => new Date(time).toISOString())).toEqual([
    '2026-04-04T13:30:00.000Z',
    '2026-04-04T14:30:00.000Z',
    '2026-04-04T16:00:00.000Z',
    '2026-04-04T17:00:00.000Z',
  ])
  const schedules = {
    s1: { id: 's1', prompt: 'Stretch', repeat: hourly, created, next: first },
  }
  expect(advance(schedules, 's1', first, first + 60_000, zone)?.next).toBe(
    Date.parse('2026-04-04T16:00:00Z'),
  )
})

test('after a move to a half-hour zone, an hourly repeat waits an hour from its last run', () => {
  const due = Date.parse('2026-10-21T12:00:00Z')
  const schedules = {
    s1: {
      id: 's1',
      prompt: 'Stretch',
      repeat: '0 * * * *',
      created: start,
      next: due,
    },
  }
  // :00 in Kolkata is :30 in UTC, so 12:30 is too soon.
  expect(
    advance(schedules, 's1', due, due + 60_000, 'Asia/Kolkata')?.next,
  ).toBe(Date.parse('2026-10-21T13:30:00Z'))
})

test('advancing a refused schedule leaves it as it was', () => {
  const repeat = 'FREQ=HOURLY;BYMINUTE=0'
  const schedule = {
    id: 's1',
    prompt: 'Stretch',
    repeat,
    created: start,
    next: at(21, 13),
    refused: repeatProblem(repeat, TEST_ZONE),
  }
  const schedules = { s1: { ...schedule } }
  expect(advance(schedules, 's1', at(21, 13), at(21, 13), TEST_ZONE)).toBe(
    undefined,
  )
  expect(schedules).toEqual({ s1: schedule })
})

test('a schedule is refused past the quota or with an oversized prompt or repeat', () => {
  const schedules = {}
  const add = (id: string, fields: { prompt?: string; repeat?: string }) =>
    addSchedule(
      schedules,
      { id, prompt: 'Stretch', at: '2026-10-22 09:00', ...fields },
      start,
      TEST_ZONE,
      2,
    )
  add('s1', {})
  expect(() =>
    add('s2', { prompt: 'x'.repeat(SCHEDULE_LIMITS.prompt + 1) }),
  ).toThrow(`${SCHEDULE_LIMITS.prompt} characters`)
  expect(() =>
    addSchedule(
      schedules,
      {
        id: 's2',
        prompt: 'Stretch',
        repeat: `0 7 * * ${'1,'.repeat(130)}1`,
      },
      start,
      TEST_ZONE,
      2,
    ),
  ).toThrow(`${SCHEDULE_LIMITS.repeat} characters`)
  add('s2', {})
  expect(() => add('s3', {})).toThrow('already 2 schedules')
  expect(Object.keys(schedules)).toEqual(['s1', 's2'])
})

test.each([0, -1, 1.5, Infinity, Number.NaN])(
  'maxSchedules %s is refused when Familiar opens',
  async (maxSchedules) => {
    await expect(
      summonFamiliar({
        storage: new ReopenableStorage(),
        models: createModels(),
        model: { provider: 'faux', modelId: 'faux-1' },
        timeZone: TEST_ZONE,
        maxSchedules,
      }),
    ).rejects.toThrow('maxSchedules must be a positive whole number')
  },
)

/** An RRULE, as repeats were saved before they were cron. */
const OLD_REPEAT = 'FREQ=HOURLY;BYMINUTE=0'

test('a stored repeat that is not valid cron is kept, paused and never runs, without blocking startup', async () => {
  const f = await setup()
  const id = await f.schedule({ repeat: '0 * * * *' })
  await f.sleepingUntil(at(21, 13))
  await f.reopen(undefined, undefined, () =>
    withHarness(f.storage, (harness) =>
      harness.commit(async (tx) => {
        ;(await tx.doc(Schedules))[id].repeat = OLD_REPEAT
      }, BACKGROUND_CONTEXT),
    ),
  )
  const kept = (await f.schedules())[id]
  expect(kept.repeat).toBe(OLD_REPEAT)
  expect(kept.refused).toBe(repeatProblem(OLD_REPEAT, TEST_ZONE))

  await f.fireAt(at(21, 14), 'done')
  expect(f.inputs).toEqual([])
  expect(f.notifications).toEqual([])
  // Still there for the owner to see and cancel, and still paused on reopen.
  await f.reopen()
  expect((await f.schedules())[id].refused).toBeDefined()
  await f.familiar().schedules.cancel(id)
  expect(await f.schedules()).toEqual({})
})

test.each([
  ['refused', true],
  ['cancelled', false],
] as const)(
  'a delivery resumed after its schedule was %s stops without delivering',
  async (_, keep) => {
    const f = await setup()
    const id = await f.schedule({ repeat: '0 * * * *' })
    await f.sleepingUntil(at(21, 13))

    // Familiar closes while 13:00's delivery waits for its reply, so its
    // task resumes in the delivery phase.
    let asked!: () => void
    const asking = new Promise<void>((resolve) => (asked = resolve))
    f.answer((signal) => {
      asked()
      return new Promise((_, reject) =>
        signal?.addEventListener('abort', () => reject(signal.reason)),
      )
    })
    f.clock.advanceTo(at(21, 13))
    await asking
    await f.reopen(undefined, undefined, () =>
      withHarness(f.storage, (harness) =>
        harness.commit(async (tx) => {
          const schedules = await tx.doc(Schedules)
          if (keep) {
            schedules[id].repeat = OLD_REPEAT
          } else {
            delete schedules[id]
          }
        }, BACKGROUND_CONTEXT),
      ),
    )

    await f.sleepingUntil('done')
    await f.familiar().idle()
    expect(f.notifications).toEqual([])
    expect(await f.scheduledEntries()).toHaveLength(1)
    // A refused one is kept for the owner, unadvanced.
    expect(await f.schedules()).toEqual(
      keep
        ? {
            [id]: expect.objectContaining({
              repeat: OLD_REPEAT,
              next: at(21, 13),
              refused: repeatProblem(OLD_REPEAT, TEST_ZONE),
            }),
          }
        : {},
    )
  },
)

test("a person's request ID can't claim a schedule's delivery", async () => {
  const f = await setup()
  const id = await f.schedule({ at: '2026-10-21 18:00' })
  // The ID the schedule's own submission uses.
  await f.familiar().send({
    author: { id: 'aidan', name: 'aidan' },
    text: 'Hello',
    requestId: `schedule:${id}:${at(21, 18)}`,
  })
  await f.familiar().idle()
  f.answer('Call Mum.')
  await f.fireAt(at(21, 18), 'done')
  expect(f.inputs).toHaveLength(1)
  expect(bodies(f.notifications)).toEqual(['Call Mum.'])
})
