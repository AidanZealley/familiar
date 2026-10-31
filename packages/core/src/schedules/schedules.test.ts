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
import { ReopenableStorage } from '../memory/testing.ts'
import { fakeClock, TEST_ZONE, timeAt } from '../testing.ts'
import { parseMinute } from '../time/index.ts'
import { occurrenceAfter, occurrenceBy, occurrencesAfter } from './repeat.ts'
import { addSchedule } from './schedules.ts'

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

async function setup(options: { onWake?: (wake: Wake) => void } = {}) {
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
    })
    opened.push(familiar)
    return familiar
  }
  let familiar = await open()

  /** Asks for a reminder, as the model would, and returns its ID. */
  const schedule = async (args: { at?: string; repeat?: string }) => {
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
      author: 'aidan',
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

  /** Closes Familiar and opens it again, at `time` and in `zone` if given. */
  const reopen = async (time?: number, zone?: string) => {
    opened.splice(opened.indexOf(familiar), 1)
    await familiar.dismiss()
    if (time !== undefined) {
      clock.setTime(time)
    }
    timeZone = zone ?? timeZone
    familiar = await open()
  }

  return {
    familiar: () => familiar,
    clock,
    inputs,
    answer: (...next: Answer[]) => answers.push(...next),
    /** Sends a message from the owner, which the model answers with `answer`. */
    say: (text: string, answer: Answer) => {
      ownerAnswers.set(text, answer)
      return familiar.send({ author: 'aidan', text, requestId: text })
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

test('a one-off reminder runs at its time, notifies with the reply, and is removed', async () => {
  const f = await setup()
  const id = await f.schedule({ at: '2026-10-21 18:00' })
  expect(Object.keys(await f.schedules())).toEqual([id])

  f.answer('**Time to call Mum!**')
  await f.fireAt(at(21, 18), 'done')

  expect(f.inputs).toEqual([
    '[Scheduled for 2026-10-21 18:00] Remind Aidan to call Mum',
  ])
  expect(f.notifications).toEqual([
    { title: 'Familiar', body: 'Time to call Mum!', url: '/' },
  ])
  expect(await f.schedules()).toEqual({})
  expect((await f.scheduledEntries()).map((entry) => entry.data)).toEqual([
    { scheduleId: id, prompt: 'Remind Aidan to call Mum', due: at(21, 18) },
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
  const id = await f.schedule({ repeat: 'FREQ=DAILY;BYHOUR=18;BYMINUTE=0' })
  await f.sleepingUntil(at(21, 18))

  // Down from before Wednesday's run until Saturday evening.
  f.answer('Call Mum.')
  await f.reopen(at(24, 21, 14))
  await f.sleepingUntil(at(25, 18))

  expect(f.inputs).toEqual([
    '[Scheduled for 2026-10-24 18:00, delivered 2026-10-24 21:14] Remind Aidan to call Mum',
  ])
  expect(f.notifications).toHaveLength(1)
  expect((await f.schedules())[id].next).toBe(at(25, 18))
})

test('a repeat keeps its local time across a daylight saving change', async () => {
  // The clocks go back at 02:00 on Sunday 25 October, so that day is 25 hours.
  expect(at(25, 7) - at(24, 7)).toBe(25 * 60 * 60 * 1000)
  const daily = 'FREQ=DAILY;BYHOUR=7;BYMINUTE=0'
  expect(occurrenceAfter(daily, start, at(24, 8), TEST_ZONE)).toBe(at(25, 7))

  const f = await setup()
  await f.schedule({ repeat: daily })
  await f.sleepingUntil(at(22, 7))
  for (const day of [22, 23, 24, 25, 26]) {
    await f.fireAt(at(day, 7), at(day + 1, 7))
  }
  expect(f.inputs).toEqual(
    [22, 23, 24, 25, 26].map(
      (day) => `[Scheduled for 2026-10-${day} 07:00] Remind Aidan to call Mum`,
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

test('a repeat at a time the clock skips moves forward by the skipped hour', () => {
  const daily = 'FREQ=DAILY;BYHOUR=1;BYMINUTE=30'
  const created = timeAt('2026-03-27 12:00')
  expect(occurrencesAfter(daily, created, created, 3, TEST_ZONE)).toEqual([
    timeAt('2026-03-28 01:30'),
    timeAt('2026-03-29 02:30'),
    timeAt('2026-03-30 01:30'),
  ])
  // Woken after the gap but before the moved occurrence, it's still next.
  expect(
    occurrenceAfter(daily, created, timeAt('2026-03-29 02:10'), TEST_ZONE),
  ).toBe(timeAt('2026-03-29 02:30'))
  expect(
    occurrenceBy(daily, created, timeAt('2026-03-29 02:10'), TEST_ZONE),
  ).toBe(timeAt('2026-03-28 01:30'))
})

test('repeat candidates stay in instant order when gap adjustment reverses wall-clock order', () => {
  const repeat = 'FREQ=DAILY;BYHOUR=1,2;BYMINUTE=0,30;BYSETPOS=2,3'
  const start = Date.parse('2026-03-28T00:00:00Z')
  expect(
    occurrenceAfter(
      repeat,
      start,
      Date.parse('2026-03-29T00:59:00Z'),
      TEST_ZONE,
    ),
  ).toBe(Date.parse('2026-03-29T01:00:00Z'))
  expect(
    occurrenceBy(repeat, start, Date.parse('2026-03-29T01:35:00Z'), TEST_ZONE),
  ).toBe(Date.parse('2026-03-29T01:30:00Z'))
})

test('an hourly repeat runs once an hour, in order, as the clocks go back', () => {
  const hourly = 'FREQ=HOURLY;BYMINUTE=30'
  const created = Date.UTC(2026, 9, 24, 22)
  const times = occurrencesAfter(hourly, created, created, 5, TEST_ZONE)
  // 01:30 is shown twice that night; the repeat runs at the first only.
  expect(times.map((time) => new Date(time).toISOString())).toEqual([
    '2026-10-24T22:30:00.000Z',
    '2026-10-24T23:30:00.000Z',
    '2026-10-25T00:30:00.000Z',
    '2026-10-25T02:30:00.000Z',
    '2026-10-25T03:30:00.000Z',
  ])
  // Woken during the repeated hour, it neither runs 01:30 again nor waits
  // past 02:30.
  const repeated = Date.UTC(2026, 9, 25, 1, 40)
  expect(occurrenceAfter(hourly, created, repeated, TEST_ZONE)).toBe(
    Date.UTC(2026, 9, 25, 2, 30),
  )
  expect(occurrenceBy(hourly, created, repeated, TEST_ZONE)).toBe(
    Date.UTC(2026, 9, 25, 0, 30),
  )
})

test("one repeat runs at 07:00 in each Familiar's own zone", () => {
  const daily = 'FREQ=DAILY;BYHOUR=7;BYMINUTE=0'
  const now = Date.UTC(2026, 5, 1, 12)
  expect(occurrenceAfter(daily, now, now, 'Asia/Tokyo')).toBe(
    Date.UTC(2026, 5, 1, 22),
  )
  expect(occurrenceAfter(daily, now, now, 'America/New_York')).toBe(
    Date.UTC(2026, 5, 2, 11),
  )
})

test('reopened in another zone, a one-off keeps its time and a repeat follows the new zone', async () => {
  const f = await setup()
  const once = await f.schedule({ at: '2026-10-22 09:00' })
  f.clock.advanceTo(at(21, 12, 1))
  const daily = await f.schedule({ repeat: 'FREQ=DAILY;BYHOUR=7;BYMINUTE=0' })
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
    '[Scheduled for 2026-10-22 02:00] Remind Aidan to call Mum',
  ])
})
