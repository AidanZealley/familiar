import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxResponseFactory,
} from '@earendil-works/pi-ai/providers/faux'
import type { AssistantMessage, TranscriptContext } from '@earendil-works/pi-ai'
import type { InboxState } from '@earendil-works/pi-durable'
import { afterEach, expect, test, vi } from 'vitest'
import { SCHEDULED_KIND } from '../conversation/index.ts'
import {
  summonFamiliar,
  type Familiar,
  type Notification,
} from '../familiar.ts'
import { ReopenableStorage } from '../memory/testing.ts'
import { fakeClock } from '../testing.ts'
import { occurrenceAfter } from './repeat.ts'
import { addSchedule } from './schedules.ts'

// Times are local, so pin a zone with a daylight saving change: 2026-10-25.
process.env.TZ = 'Europe/London'

const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).getTime()

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

async function setup() {
  const storage = new ReopenableStorage()
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const clock = fakeClock(start)
  const notifications: Notification[] = []

  // Scheduled inputs take the next answer in turn, and the owner's messages
  // the answer given for them. Anything else, such as memory upkeep at
  // 04:00, hears there's nothing to do.
  const inputs: string[] = []
  const answers: Answer[] = []
  const ownerAnswers = new Map<string, Answer>()
  const respond: FauxResponseFactory = (context, options) => {
    const input = inputOf(context)
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
      now: clock.now,
      setTimer: clock.setTimer,
      notify: async (notification) => {
        notifications.push(notification)
      },
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

  /** Closes Familiar and opens it again, at `time` if given. */
  const reopen = async (time?: number) => {
    opened.splice(opened.indexOf(familiar), 1)
    await familiar.dismiss()
    if (time !== undefined) {
      clock.setTime(time)
    }
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
  expect(occurrenceAfter(daily, start, at(24, 8))).toBe(at(25, 7))

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
    ),
  ).toThrow('that exists')
})
