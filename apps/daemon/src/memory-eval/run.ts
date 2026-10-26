import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Models } from '@earendil-works/pi-ai'
import type { ModelRef, Storage } from '@earendil-works/pi-durable'
import { openFamiliar } from '@familiar/core'
import { nextUpkeep, saidBy } from '@familiar/memory'
import { setTimeout } from 'node:timers/promises'
import { createClock } from './clock.ts'
import { judgeAnswer, type Verdict } from './judge.ts'
import type { Question, Scenario } from './scenario.ts'

export type QuestionResult = Question & { answer: string; verdict: Verdict }
export type EvalResult = {
  scenario: string
  days: number
  results: QuestionResult[]
}

async function waitForUpkeep(storage: Storage, until: number) {
  const deadline = Date.now() + 120_000
  for (;;) {
    const { items } = await storage.scanTasks(
      { kind: 'familiar.upkeep' },
      2,
      undefined,
      BACKGROUND_CONTEXT,
    )
    const state = items[0]?.state
    if (
      items.length === 1 &&
      state?.status === 'sleeping' &&
      state.until === until
    )
      return
    if (state?.status === 'terminal' || Date.now() >= deadline)
      throw new Error(
        `Memory upkeep did not settle before ${new Date(until).toISOString()}.`,
      )
    await setTimeout(50)
  }
}

/** One fresh Familiar owns the replay and closes its storage. */
export async function runMemoryEval({
  storage,
  models,
  model,
  scenario,
  progress = () => {},
}: {
  storage: Storage
  models: Models
  model: ModelRef
  scenario: Scenario
  progress?: (message: string) => void
}): Promise<EvalResult> {
  if (!scenario.days.length)
    throw new Error('Memory eval needs at least one day.')
  const first = new Date(`${scenario.days[0].date}T12:00:00`)
  if (Number.isNaN(first.getTime()))
    throw new Error('Invalid first scenario date.')
  const clock = createClock(first.getTime())
  const familiar = await openFamiliar({
    storage,
    models,
    model,
    // The default 64k budget would fit this whole scenario verbatim. Keep the
    // usual compaction mechanism, but make old facts depend on memory or search.
    contextBudget: 4_000,
    now: clock.now,
    setTimer: clock.setTimer,
  })

  try {
    await waitForUpkeep(storage, nextUpkeep(clock.now()))
    for (const [index, day] of scenario.days.entries()) {
      const noon = new Date(`${day.date}T12:00:00`).getTime()
      if (Number.isNaN(noon) || noon < clock.now())
        throw new Error(`Scenario day ${day.date} is invalid or out of order.`)
      clock.advanceTo(noon)
      if (day.text) {
        await familiar.send({
          author: 'Rowan',
          text: day.text,
          requestId: `eval:day:${index}`,
        })
        await familiar.idle()
        progress(`Day ${index + 1}/${scenario.days.length}: ${day.date}`)
      }
      const followingNoon = new Date(noon)
      followingNoon.setDate(followingNoon.getDate() + 1)
      const pass = nextUpkeep(noon)
      clock.advanceTo(pass)
      await waitForUpkeep(storage, nextUpkeep(pass))
      clock.advanceTo(followingNoon.getTime())
    }

    const results: QuestionResult[] = []
    for (const question of scenario.questions) {
      await familiar.send({
        author: 'Rowan',
        text: question.text,
        requestId: `eval:question:${question.id}`,
      })
      await familiar.idle()
      const watch = await familiar.watch()
      await watch.stop()
      const last = watch.value.entries.at(-1)
      const answer =
        last?.kind === 'pi.assistant' ? saidBy(last)?.text : undefined
      if (!answer) throw new Error(`No assistant answer for ${question.id}.`)
      const verdict = await judgeAnswer(models, model, question, answer)
      results.push({ ...question, answer, verdict })
      progress(`${question.id}: ${verdict.pass ? 'pass' : 'fail'}`)
    }
    return { scenario: scenario.id, days: scenario.days.length, results }
  } finally {
    await familiar.close()
  }
}
