import type { Models } from '@earendil-works/pi-ai'
import type { ModelRef, Storage } from '@earendil-works/pi-durable'
import { summonFamiliar } from '@familiar/core'
import { createClock } from './clock.ts'
import { askQuestions, type QuestionResult } from './questions.ts'
import { replayScenario, type UpkeepResult } from './replay.ts'
import type { Scenario } from './scenario.ts'
import { addTokens, noTokens, tokensOf, type Tokens } from './tokens.ts'

export type EvalResult = {
  scenario: string
  days: number
  /** Pinned apart from the model under test so a model change doesn't also change the grading. */
  judge: string
  memory: { document: unknown; characters: number }
  compactions: number
  upkeep: UpkeepResult[]
  /** Replay includes its compactions and nightly upkeep. */
  tokens: { replay: Tokens; answers: Tokens; judge: Tokens }
  results: QuestionResult[]
}

export async function runMemoryEval({
  storage,
  createQuestionStorage,
  models,
  model,
  judge,
  scenario,
  progress = () => {},
  questionConcurrency = 3,
}: {
  storage: Storage
  /** Called after replay storage closes; each call opens a separate copy of its SQLite file. */
  createQuestionStorage: (id: string) => Promise<Storage>
  models: Models
  model: ModelRef
  judge: ModelRef
  scenario: Scenario
  progress?: (message: string) => void
  questionConcurrency?: number
}): Promise<EvalResult> {
  if (!scenario.days.length)
    throw new Error('Memory eval needs at least one day.')
  if (!Number.isInteger(questionConcurrency) || questionConcurrency < 1)
    throw new Error('Question concurrency must be positive.')
  const first = new Date(`${scenario.days[0].date}T12:00:00`)
  if (Number.isNaN(first.getTime()))
    throw new Error('Invalid first scenario date.')
  const clock = createClock(first.getTime())
  const familiar = await summonFamiliar({
    storage,
    models,
    model,
    contextBudget: 4_000,
    now: clock.now,
    setTimer: clock.setTimer,
  })
  let replay: Awaited<ReturnType<typeof replayScenario>>
  let replayed: Tokens
  try {
    replay = await replayScenario(familiar, storage, clock, scenario, progress)
    replayed = tokensOf(await familiar.usage())
  } finally {
    await familiar.dismiss()
  }
  const results = await askQuestions({
    createQuestionStorage,
    models,
    model,
    judge,
    scenario,
    progress,
    questionConcurrency,
    now: clock.now(),
  })
  return {
    scenario: scenario.id,
    days: scenario.days.length,
    judge: judge.modelId,
    ...replay,
    tokens: {
      replay: replayed,
      answers: results
        .map(({ tokens }) => tokens.answer)
        .reduce(addTokens, noTokens),
      judge: results
        .map(({ tokens }) => tokens.judge)
        .reduce(addTokens, noTokens),
    },
    results,
  }
}
