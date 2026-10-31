import type { Models } from '@earendil-works/pi-ai'
import type { ModelRef, Storage } from '@earendil-works/pi-durable'
import { summonFamiliar } from '@familiar/core'
import { createClock, EVAL_TIME_ZONE } from './clock.ts'
import { askQuestions, type QuestionResult } from './questions.ts'
import { replayScenario, resumePoint, type UpkeepResult } from './replay.ts'
import type { Scenario } from './scenario.ts'
import { addTokens, noTokens, tokensOf, type Tokens } from './tokens.ts'

export type EvalResult = {
  scenario: string
  days: number
  /** Pinned apart from the model under test so a model change doesn't also change the grading. */
  judge: string
  /** Set when the replay was resumed: the first day this run sent. Upkeep outcomes start there. */
  resumedFrom?: string
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
  resume = false,
  previous,
  onAnswer,
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
  /** Continue a replay stopped partway, such as by a usage limit, from its storage. */
  resume?: boolean
  /** Questions graded by an earlier attempt, kept rather than asked again. */
  previous?: QuestionResult[]
  onAnswer?: (result: QuestionResult) => void
}): Promise<EvalResult> {
  if (!scenario.days.length) {
    throw new Error('Memory eval needs at least one day.')
  }
  if (!Number.isInteger(questionConcurrency) || questionConcurrency < 1) {
    throw new Error('Question concurrency must be positive.')
  }
  const fromDay = resume ? await resumePoint(storage, scenario) : 0
  // A finished replay resumes at the noon after its last day, as if it had
  // just ended, and goes straight to the questions.
  const done = fromDay >= scenario.days.length
  const first = new Date(
    `${scenario.days[done ? scenario.days.length - 1 : fromDay].date}T12:00:00`,
  )
  if (Number.isNaN(first.getTime())) {
    throw new Error('Invalid first scenario date.')
  }
  if (done) {
    first.setDate(first.getDate() + 1)
  }
  const clock = createClock(first.getTime())
  if (done) {
    progress('Replay already finished; asking the questions.')
  } else if (fromDay > 0) {
    progress(`Resuming at day ${fromDay + 1}: ${scenario.days[fromDay].date}`)
  }
  const familiar = await summonFamiliar({
    storage,
    models,
    model,
    contextBudget: 4_000,
    timeZone: EVAL_TIME_ZONE,
    now: clock.now,
    setTimer: clock.setTimer,
  })
  let replay: Awaited<ReturnType<typeof replayScenario>>
  let replayed: Tokens
  try {
    replay = await replayScenario(
      familiar,
      storage,
      clock,
      scenario,
      progress,
      fromDay,
    )
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
    previous,
    onAnswer,
  })
  return {
    scenario: scenario.id,
    days: scenario.days.length,
    judge: judge.modelId,
    ...(fromDay > 0 && {
      resumedFrom: scenario.days[fromDay]?.date ?? 'questions',
    }),
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
