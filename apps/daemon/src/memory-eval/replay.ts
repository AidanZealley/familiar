import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Storage } from '@earendil-works/pi-durable'
import type { Familiar } from '@familiar/core'
import {
  nextUpkeep,
  saidBy,
  type UpkeepState,
} from '@familiar/core/diagnostics'
import { createClock } from './clock.ts'
import type { Scenario } from './scenario.ts'
import { entriesAfter, tasksIn } from './storage.ts'
import { WAIT_MS, waitForIdle, waitForUpkeep, waitWithClock } from './wait.ts'

const context = BACKGROUND_CONTEXT

export type UpkeepResult = {
  date: string
  throughBefore: number | null
  throughAfter: number | null
  outcome: 'advanced' | 'no-messages'
}

async function upkeepThrough(storage: Storage): Promise<number | null> {
  const record = await storage.findDocument(
    { kind: 'familiar.upkeep', scope: { kind: 'session' } },
    'current',
    context,
  )
  if (!record) throw new Error('Memory upkeep document is missing.')
  const document = await storage.document(record.id, 'current', context)
  if (!document) throw new Error('Memory upkeep document could not be read.')
  return (document.value as UpkeepState).through
}

/**
 * The first scenario day a stopped replay hasn't sent yet: the day after the
 * newest message from Rowan, on the eval's fake clock. 0 for a fresh replay.
 */
export async function resumePoint(storage: Storage, scenario: Scenario) {
  let newest = -Infinity
  for (const entry of await entriesAfter(storage)) {
    const said = saidBy(entry)
    // Replies carry wall-clock times; only Rowan's messages use the fake clock.
    if (said && said.who !== 'you') newest = Math.max(newest, said.at)
  }
  if (newest === -Infinity) return 0
  const sent = scenario.days.findIndex(
    (day) => new Date(`${day.date}T12:00:00`).getTime() === newest,
  )
  if (sent === -1)
    throw new Error('The stored replay does not match this scenario.')
  return sent + 1
}

/**
 * Replays the scenario from `fromDay`. A resumed replay first lets an
 * interrupted reply and any overdue upkeep pass finish.
 */
export async function replayScenario(
  familiar: Familiar,
  storage: Storage,
  clock: ReturnType<typeof createClock>,
  scenario: Scenario,
  progress: (message: string) => void,
  fromDay = 0,
) {
  const upkeep: UpkeepResult[] = []
  if (fromDay > 0)
    await waitForIdle(
      familiar,
      clock,
      nextUpkeep(clock.now()),
      'Resumed replay to settle',
    )
  await waitForUpkeep(familiar, storage, clock, nextUpkeep(clock.now()))
  for (const [index, day] of scenario.days.entries()) {
    if (index < fromDay) continue
    const noon = new Date(`${day.date}T12:00:00`).getTime()
    if (Number.isNaN(noon) || noon < clock.now())
      throw new Error(`Scenario day ${day.date} is invalid or out of order.`)
    clock.advanceTo(noon)
    const before = await upkeepThrough(storage)
    if (day.text) {
      await familiar.send({
        author: 'Rowan',
        text: day.text,
        requestId: `eval:day:${index}`,
      })
      await waitForIdle(
        familiar,
        clock,
        nextUpkeep(noon),
        `Day ${day.date} reply`,
      )
      progress(`Day ${index + 1}/${scenario.days.length}: ${day.date}`)
    }
    const pass = nextUpkeep(noon)
    clock.advanceTo(pass)
    const followingNoon = new Date(noon)
    followingNoon.setDate(followingNoon.getDate() + 1)
    await waitForUpkeep(
      familiar,
      storage,
      clock,
      nextUpkeep(pass),
      Math.min(nextUpkeep(pass), followingNoon.getTime()),
    )
    const after = await upkeepThrough(storage)
    if (day.text && (after === null || (before !== null && after <= before)))
      throw new Error(
        `Memory upkeep on ${day.date} did not advance through (before ${before}, after ${after}).`,
      )
    upkeep.push({
      date: day.date,
      throughBefore: before,
      throughAfter: after,
      outcome: after !== before ? 'advanced' : 'no-messages',
    })
    clock.advanceTo(followingNoon.getTime())
  }
  await waitWithClock(
    clock,
    nextUpkeep(clock.now()),
    'Replay tasks to settle before copying',
    async () => {
      const live = (await tasksIn(storage)).filter(
        (task) => task.state.status !== 'terminal',
      )
      return (
        live.length === 1 &&
        live[0].kind === 'familiar.upkeep' &&
        live[0].state.status === 'sleeping'
      )
    },
    WAIT_MS,
    familiar.onCommit,
  )
  if (scenario.testedFactsThrough) {
    const transcript = await familiar.watch()
    try {
      const cutoff = new Date(
        `${scenario.testedFactsThrough}T23:59:59`,
      ).getTime()
      if (
        transcript.value.entries.some((entry) => {
          const said = saidBy(entry)
          return (
            said &&
            (said.at <= cutoff ||
              (entry.kind === 'pi.assistant' &&
                scenario.testedPhrases?.some((phrase) =>
                  said.text.toLowerCase().includes(phrase.toLowerCase()),
                )))
          )
        })
      )
        throw new Error(
          'Tested sessions remain in verbatim context. Add more filler before asking questions.',
        )
    } finally {
      await transcript.stop()
    }
  }
  const watch = await familiar.memory.watch()
  const memory = {
    document: watch.value,
    characters:
      watch.value?.facts.map((fact) => `${fact.id}: ${fact.text}`).join('\n')
        .length ?? 0,
  }
  await watch.stop()
  const compactions = (await entriesAfter(storage)).filter(
    (entry) => entry.kind === 'pi.compaction',
  ).length
  return { memory, compactions, upkeep }
}
