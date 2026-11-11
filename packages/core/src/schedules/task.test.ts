import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxResponseFactory,
} from '@earendil-works/pi-ai/providers/faux'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { InboxState, Wake } from '@earendil-works/pi-durable'
import { expect, test, vi } from 'vitest'
import { SCHEDULED_KIND } from '../conversation/message.ts'
import { type Notification, type NotificationContext } from '../index.ts'
import { onlyFamiliar, withHarness } from '../memory/testing.ts'
import { familiarDoc } from '../workspace/familiars.ts'
import { fakeClock, inputOf, TEST_ZONE, testHost, timeAt } from '../testing.ts'
import {
  defineTool,
  familiar,
  Type,
  type Author,
  type FamiliarPlugin,
} from '../index.ts'
import { Schedules } from './schedules.ts'

// Each schedule's task, end to end through a Familiar: the model, the
// conversation, notify and restarts. The rules themselves are in
// schedules.test.ts.

const pad = (value: number) => String(value).padStart(2, '0')

/** A time in October 2026 in TEST_ZONE, where the clocks go back on the 25th. */
const at = (day: number, hour: number, minute = 0) =>
  timeAt(`2026-10-${pad(day)} ${pad(hour)}:${pad(minute)}`)

/** Wednesday 21 October 2026, local noon. */
const start = at(21, 12)

/** How the model answers a scheduled input: a reply, or a scripted message. */
type Answer =
  | string
  | ((signal?: AbortSignal) => AssistantMessage | Promise<AssistantMessage>)

async function setup(
  options: { onWake?: (wake: Wake) => void; plugins?: FamiliarPlugin[] } = {},
) {
  const clock = fakeClock(start)
  const notifications: Notification[] = []
  const contexts: (NotificationContext | undefined)[] = []

  // Scheduled inputs take the next answer in turn, and the owner's messages
  // the answer given for them. Anything else, such as memory upkeep at
  // 04:00, hears there's nothing to do.
  const inputs: string[] = []
  const answers: Answer[] = []
  const ownerAnswers = new Map<string, Answer>()
  const respond: FauxResponseFactory = (context, options) => {
    // Owners' messages by their words, without the line naming them, and
    // either without what the room showed first.
    const raw = inputOf(context)
    const start = Math.max(
      raw.lastIndexOf('[Scheduled for'),
      raw.lastIndexOf('[Message from {'),
    )
    const input = raw.slice(start).replace(/^\[Message from .*\n/, '')
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

  const host = await testHost({
    timeZone: TEST_ZONE,
    now: clock.now,
    setTimer: clock.setTimer,
    notify: async (notification, context) => {
      notifications.push(notification)
      contexts.push(context)
    },
    onWake: options.onWake,
    plugins: options.plugins,
  })
  const { faux, storage } = host

  let asks = 0
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
    await host.send({
      author,
      text: 'Remind me to call Mum',
      requestId: `ask:${++asks}`,
    })
    const id = /Scheduled (s\d+)/.exec(result)?.[1]
    expect(id, result).toBeDefined()
    return id!
  }

  const schedules = async () => {
    const watch = await host.familiar().schedules.watch()
    await watch.stop()
    return watch.value ?? {}
  }

  const scheduledEntries = async () => {
    const watch = await host.familiar().watch()
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

  /** Waits until every schedule's task is asleep or finished, and the conversation is idle. */
  const settled = () =>
    vi.waitFor(async () => {
      const tasks = (
        await storage.scanTasks(
          { kind: 'familiar.schedule' },
          20,
          undefined,
          BACKGROUND_CONTEXT,
        )
      ).items
      for (const task of tasks) {
        expect(['sleeping', 'terminal']).toContain(task.state.status)
      }
      const turns = await host.dm().watchTurns()
      await turns.stop()
      expect(turns.value).toEqual({})
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
    await host.reopen(zone ? { timeZone: zone } : {}, async () => {
      await meanwhile?.()
      if (time !== undefined) {
        clock.setTime(time)
      }
    })
  }

  return {
    familiar: host.familiar,
    workspace: host.workspace,
    storage,
    clock,
    inputs,
    answer: (...next: Answer[]) => answers.push(...next),
    /** Sends a message from the owner, which the model answers with `answer`. */
    say: (text: string, answer: Answer) => {
      ownerAnswers.set(text, answer)
      return host.dm().post({
        author: { id: 'aidan', name: 'aidan' },
        text,
        requestId: text,
      })
    },
    notifications,
    /** Each notification's context, in the same order. */
    contexts,
    send: host.send,
    schedule,
    schedules,
    scheduledEntries,
    sleepingUntil,
    settled,
    fireAt,
    reopen,
  }
}

const bodies = (notifications: Notification[]) =>
  notifications.map(({ body }) => body)

/** An answer the model never finishes, until Familiar closes; `asked` settles when it starts. */
function hanging() {
  let started!: () => void
  const asked = new Promise<void>((resolve) => (started = resolve))
  const answer = (signal?: AbortSignal) => {
    started()
    return new Promise<AssistantMessage>((_, reject) =>
      signal?.addEventListener('abort', () => reject(signal.reason)),
    )
  }
  return { answer, asked }
}

const failure = (errorMessage: string) => () =>
  fauxAssistantMessage('', { stopReason: 'error', errorMessage })

test('a one-off runs at its time for whoever asked, whatever request IDs people send, notifies with the reply and is removed', async () => {
  const seen: (Author | undefined)[] = []
  const f = await setup({
    plugins: [
      {
        name: 'identity',
        title: 'Identity',
        tools: [
          defineTool({
            name: 'identify',
            description: 'Report the creator',
            parameters: Type.Object({}),
            execute: async (_args, _api, context) => {
              seen.push(await familiar(context).author())
              return { output: [{ type: 'text', text: 'Identified' }] }
            },
          }),
        ],
      },
    ],
  })
  const sam = { id: 'sam-1', name: 'Sam' }
  const id = await f.schedule({ at: '2026-10-21 18:00' }, { ...sam })
  // A rename later doesn't change who asked.
  await f.schedule({ at: '2026-10-21 19:00' }, { ...sam, name: 'Samuel' })
  await f.familiar().schedules.cancel(`${Object.keys(await f.schedules())[1]}`)
  // A person sends the ID the schedule's own delivery uses.
  await f.send({
    author: { id: 'aidan', name: 'aidan' },
    text: 'Hello',
    requestId: `schedule:${id}:${at(21, 18)}`,
  })
  await f.reopen()
  expect((await f.schedules())[id].creator).toEqual(sam)

  f.answer(
    () =>
      fauxAssistantMessage(fauxToolCall('identify', {}), {
        stopReason: 'toolUse',
      }),
    '**Time to call Mum!**',
  )
  await f.fireAt(at(21, 18), 'done')

  expect(f.inputs[0]).toBe(
    '[Scheduled for 2026-10-21 18:00; requested by {"id":"sam-1","name":"Sam"}] Remind Aidan to call Mum',
  )
  // The creator reaches tools and the host as attribution, not recipients.
  expect(seen).toEqual([sam])
  expect(f.notifications).toEqual([
    { title: 'Familiar', body: 'Time to call Mum!', url: '/' },
  ])
  expect(f.contexts).toEqual([{ scheduleId: id, creator: sam }])
  expect(await f.schedules()).toEqual({})
  expect((await f.scheduledEntries()).map((entry) => entry.data)).toMatchObject(
    [
      {
        scheduleId: id,
        prompt: 'Remind Aidan to call Mum',
        due: at(21, 18),
        creator: sam,
      },
    ],
  )
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
  expect(f.workspace().wake()).toEqual({ active: false, at: at(21, 18) })

  f.answer('**Time to call Mum!**')
  f.clock.advanceTo(at(21, 18))
  await new Promise((resolve) => setTimeout(resolve, 50))
  await f.sleepingUntil(at(21, 18))
  expect(f.notifications).toEqual([])

  f.workspace().resume()
  await f.sleepingUntil('done')
  await vi.waitFor(() =>
    expect(bodies(f.notifications)).toEqual(['Time to call Mum!']),
  )
  // Next is upkeep's 04:00 pass.
  await vi.waitFor(() =>
    expect(f.workspace().wake()).toEqual({ active: false, at: at(22, 4) }),
  )
})

test('a reminder still notifies once through a restart, a failed run and a busy conversation, and a cancelled one never runs', async () => {
  const f = await setup()
  const six = await f.schedule({ at: '2026-10-21 18:00' })
  const half = await f.schedule({ at: '2026-10-21 18:30' })
  const seven = await f.schedule({ at: '2026-10-21 19:00' })
  const eight = await f.schedule({ at: '2026-10-21 20:00' })

  // Cancelled before its time: no input and no notification.
  await f.familiar().schedules.cancel(half)
  await expect(f.familiar().schedules.cancel(half)).rejects.toThrow(
    `No schedule ${half}.`,
  )

  // 18:00's reply is still coming when Familiar closes; the next process
  // asks again, under the same request, and that run fails: the
  // notification falls back to the prompt.
  const first = hanging()
  f.answer(first.answer, failure('The model failed on purpose.'))
  f.clock.advanceTo(at(21, 18))
  await first.asked
  await f.reopen()
  await f.settled()
  f.clock.advanceTo(at(21, 18, 30))
  await f.settled()
  expect(bodies(f.notifications)).toEqual(['Remind Aidan to call Mum'])
  // The rerun's checkpoint still names who asked.
  expect(f.contexts).toEqual([
    { scheduleId: six, creator: { id: 'aidan', name: 'aidan' } },
  ])
  expect(await f.scheduledEntries()).toHaveLength(1)

  // 19:00 queues behind the owner's run, which fails; it still runs.
  let fail!: () => void
  const failing = new Promise<void>((resolve) => (fail = resolve))
  await f.say('Hello', async () => {
    await failing
    return failure('Usage limit reached.')()
  })
  f.answer('Call Mum.')
  f.clock.advanceTo(at(21, 19))
  await vi.waitFor(async () => {
    const watch = await f.familiar().watch()
    await watch.stop()
    const inbox = watch.value.docs['pi.inbox'] as InboxState | undefined
    expect(inbox?.items).toHaveLength(1)
  })
  fail()
  await vi.waitFor(() =>
    expect(bodies(f.notifications)).toEqual([
      'Remind Aidan to call Mum',
      'Call Mum.',
    ]),
  )
  expect(f.contexts[1]?.scheduleId).toBe(seven)

  // 20:00 is cancelled while its delivery waits for the reply: the resumed
  // delivery stops without notifying.
  const last = hanging()
  f.answer(last.answer)
  f.clock.advanceTo(at(21, 20))
  await last.asked
  await f.reopen(undefined, undefined, () =>
    withHarness(f.storage, (harness) =>
      harness.commit(async (tx) => {
        delete (await familiarDoc(tx, Schedules, await onlyFamiliar(tx)))[eight]
      }, BACKGROUND_CONTEXT),
    ),
  )
  await f.settled()
  expect(f.notifications).toHaveLength(2)
  expect(await f.scheduledEntries()).toHaveLength(3)
  expect(await f.schedules()).toEqual({})
})

test('a daily repeat woken late delivers once, marked late, keeps its local time across the clock change, and follows a new zone', async () => {
  const f = await setup()
  const daily = await f.schedule({ repeat: '0 7 * * *' })
  const once = await f.schedule({ at: '2026-10-27 09:00' })
  expect((await f.schedules())[daily].next).toBe(at(22, 7))

  // Down from before Thursday's run until Saturday morning: only Saturday's
  // is delivered, marked late.
  await f.reopen(at(24, 9, 14))
  await vi.waitFor(async () =>
    expect((await f.schedules())[daily].next).toBe(at(25, 7)),
  )
  // Sunday is 25 hours long, as the clocks go back; it's still 07:00.
  f.clock.advanceTo(at(25, 7))
  await vi.waitFor(async () =>
    expect((await f.schedules())[daily].next).toBe(at(26, 7)),
  )

  // The owner moves to New York, four hours behind London that week. The
  // occurrence already set keeps its time, and so does the one-off; the
  // next follows New York: 07:00 there, later the same day.
  await f.reopen(at(25, 12), 'America/New_York')
  expect((await f.schedules())[once].next).toBe(at(27, 9))
  f.clock.advanceTo(at(26, 7))
  await vi.waitFor(async () =>
    expect((await f.schedules())[daily].next).toBe(Date.UTC(2026, 9, 26, 11)),
  )
  await f.settled()

  expect(f.inputs).toEqual([
    '[Scheduled for 2026-10-24 07:00, delivered 2026-10-24 09:14; requested by {"id":"aidan","name":"aidan"}] Remind Aidan to call Mum',
    '[Scheduled for 2026-10-25 07:00; requested by {"id":"aidan","name":"aidan"}] Remind Aidan to call Mum',
    '[Scheduled for 2026-10-26 03:00; requested by {"id":"aidan","name":"aidan"}] Remind Aidan to call Mum',
  ])
})

test('paused, a repeat skips what falls due and a one-off waits past its time; resumed, each runs again, the one-off late and once', async () => {
  const f = await setup()
  const daily = await f.schedule({ repeat: '0 18 * * *' })
  const once = await f.schedule({ at: '2026-10-21 19:00' })
  const schedules = f.familiar().schedules
  await schedules.pause(daily)
  await schedules.pause(once)
  await expect(schedules.pause('s0')).rejects.toThrow('No schedule s0.')

  f.clock.advanceTo(at(21, 18))
  await f.settled()
  f.clock.advanceTo(at(21, 19))
  await f.settled()
  expect(f.notifications).toEqual([])
  // The repeat's next run is still the one it would have; the one-off keeps its time.
  expect(await f.schedules()).toMatchObject({
    [daily]: { paused: true, next: at(22, 18) },
    [once]: { paused: true, next: at(21, 19) },
  })

  f.clock.setTime(at(21, 20))
  await schedules.resume(once)
  await schedules.resume(daily)
  // Resuming what isn't paused changes nothing.
  await schedules.resume(daily)
  await vi.waitFor(() => expect(f.notifications).toHaveLength(1))
  await f.settled()
  expect(f.inputs).toEqual([
    '[Scheduled for 2026-10-21 19:00, delivered 2026-10-21 20:00; requested by {"id":"aidan","name":"aidan"}] Remind Aidan to call Mum',
  ])
  expect(Object.keys(await f.schedules())).toEqual([daily])

  // The repeat's own task runs it, once.
  f.clock.advanceTo(at(22, 18))
  await vi.waitFor(() => expect(f.notifications).toHaveLength(2))
  await f.settled()
  expect(f.notifications).toHaveLength(2)
  expect(await f.schedules()).toMatchObject({ [daily]: { next: at(23, 18) } })
  expect((await f.schedules())[daily]).not.toHaveProperty('paused')
})
