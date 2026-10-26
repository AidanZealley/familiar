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
import { openFamiliar, type Familiar } from '../familiar.ts'

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
    const familiar = await openFamiliar({
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
    await familiar.close()
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
  return { faux, say, memory, upkeepTasks, sleepingUntil, passAt, reopen }
}

const opened: Familiar[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((familiar) => familiar.close()))
})

/** The pass's input: the last user message of an upkeep request. */
const inputOf = (context: TranscriptContext) => {
  const last = context.messages.findLast((message) => message.role === 'user')
  return typeof last?.content === 'string'
    ? last.content
    : (last?.content ?? [])
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('')
}

const isUpkeep = (context: TranscriptContext) =>
  JSON.stringify(context.messages).includes('long-term memory of Familiar')

test('a pass at 04:00 consolidates memory with the memory tools', async () => {
  const { faux, say, memory, passAt } = await setup()
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall('remember', { text: 'Has a cat' }),
        fauxToolCall('remember', { text: 'Owns a cat called Miso' }),
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
          fauxToolCall('forget', { id: 'm1' }),
          fauxToolCall('remember', { text: 'Is vegetarian' }),
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
  expect((await memory()).map((fact) => fact.text)).toEqual([
    'Owns a cat called Miso',
    'Is vegetarian',
  ])
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
