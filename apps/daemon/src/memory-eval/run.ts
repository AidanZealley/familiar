import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Models } from '@earendil-works/pi-ai'
import {
  ROOT_CONVERSATION_ID,
  type EntryId,
  type EntryRecord,
  type ModelRef,
  type Storage,
} from '@earendil-works/pi-durable'
import { openFamiliar, type Familiar } from '@familiar/core'
import { nextUpkeep, saidBy, type UpkeepState } from '@familiar/memory'
import { setTimeout } from 'node:timers/promises'
import { createClock } from './clock.ts'
import { judgeAnswer, type Verdict } from './judge.ts'
import {
  categories,
  type Category,
  type Question,
  type Scenario,
} from './scenario.ts'

const WAIT_MS = 120_000
const context = BACKGROUND_CONTEXT
export type QuestionResult = Question & {
  answer: string
  verdict: Verdict
  toolCalls: { id: string; name: string; arguments: unknown; result: unknown }[]
}
export type UpkeepResult = {
  date: string
  throughBefore: number | null
  throughAfter: number | null
  outcome: 'advanced' | 'no-messages'
}
export type EvalResult = {
  scenario: string
  days: number
  judgeIsTestModel: true
  memory: { document: unknown; characters: number }
  compactions: number
  upkeep: UpkeepResult[]
  results: QuestionResult[]
}

export function summarize(results: QuestionResult[]) {
  return categories.map((category: Category) => ({
    category,
    passed: results.filter(
      (result) => result.category === category && result.verdict.pass,
    ).length,
    total: results.filter((result) => result.category === category).length,
  }))
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

async function entriesAfter(storage: Storage, after?: EntryId) {
  const entries: EntryRecord[] = []
  let cursor: Parameters<Storage['scanEntries']>[2]
  do {
    const page = await storage.scanEntries(
      {
        conversationId: ROOT_CONVERSATION_ID,
        order: 'ascending',
        ...(after === undefined ? {} : { minEntryId: (after + 1) as EntryId }),
      },
      200,
      cursor,
      context,
    )
    entries.push(...page.items)
    cursor = page.next
  } while (cursor)
  return entries
}

/** Give asynchronous work time to arm retries, then fire only timers before the next scripted event. */
export async function waitWithClock(
  clock: ReturnType<typeof createClock>,
  boundary: number,
  label: string,
  check: () => Promise<boolean>,
  timeoutMs = WAIT_MS,
) {
  let stopped = false
  const abort = new AbortController()
  const timeout = setTimeout(timeoutMs, undefined, {
    signal: abort.signal,
  }).then(() => {
    throw new Error(
      `${label} timed out after ${timeoutMs / 1000}s at simulated ${new Date(clock.now()).toISOString()}.`,
    )
  })
  try {
    await Promise.race([
      (async () => {
        while (!stopped && !(await check())) {
          await setTimeout(25)
          if (stopped) return
          const due = clock.nextDue()
          if (due < boundary && due >= clock.now()) clock.advanceTo(due)
        }
      })(),
      timeout,
    ])
  } finally {
    stopped = true
    abort.abort()
  }
}

async function waitForIdle(
  familiar: Familiar,
  clock: ReturnType<typeof createClock>,
  boundary: number,
  label: string,
) {
  let settled = false
  let failure: unknown
  void familiar.idle().then(
    () => {
      settled = true
    },
    (error: unknown) => {
      failure = error
      settled = true
    },
  )
  await waitWithClock(clock, boundary, label, async () => settled)
  if (failure) throw new Error(`${label} failed.`, { cause: failure })
}

async function waitForUpkeep(
  storage: Storage,
  clock: ReturnType<typeof createClock>,
  until: number,
) {
  await waitWithClock(
    clock,
    until,
    `Memory upkeep before ${new Date(until).toISOString()}`,
    async () => {
      const { items } = await storage.scanTasks(
        { kind: 'familiar.upkeep' },
        2,
        undefined,
        context,
      )
      const state = items[0]?.state
      if (state?.status === 'terminal')
        throw new Error(`Memory upkeep ended: ${JSON.stringify(state.outcome)}`)
      return (
        items.length === 1 &&
        state?.status === 'sleeping' &&
        state.until === until
      )
    },
  )
}

export async function runMemoryEval({
  storage,
  createQuestionStorage,
  models,
  model,
  scenario,
  progress = () => {},
  questionConcurrency = 3,
}: {
  storage: Storage
  /** Called after replay storage closes; each call opens a separate copy of its SQLite file. */
  createQuestionStorage: (id: string) => Promise<Storage>
  models: Models
  model: ModelRef
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
  const options = {
    models,
    model,
    contextBudget: 4_000,
    now: clock.now,
    setTimer: clock.setTimer,
  }
  const familiar = await openFamiliar({ storage, ...options })
  let memory: EvalResult['memory']
  let compactions: number
  const upkeep: UpkeepResult[] = []
  try {
    await waitForUpkeep(storage, clock, nextUpkeep(clock.now()))
    for (const [index, day] of scenario.days.entries()) {
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
      await waitForUpkeep(storage, clock, nextUpkeep(pass))
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
      const followingNoon = new Date(noon)
      followingNoon.setDate(followingNoon.getDate() + 1)
      clock.advanceTo(followingNoon.getTime())
    }
    if (scenario.testedFactsThrough) {
      const transcript = await familiar.watch()
      try {
        const cutoff = new Date(
          `${scenario.testedFactsThrough}T23:59:59`,
        ).getTime()
        if (
          transcript.value.entries.some((entry) => {
            const said = saidBy(entry)
            return said && said.at <= cutoff
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
    memory = {
      document: watch.value,
      characters:
        watch.value?.facts.map((fact) => `${fact.id}: ${fact.text}`).join('\n')
          .length ?? 0,
    }
    await watch.stop()
    compactions = (await entriesAfter(storage)).filter(
      (entry) => entry.kind === 'pi.compaction',
    ).length
  } finally {
    await familiar.close()
  }

  const results = new Array<QuestionResult>(scenario.questions.length)
  let next = 0
  const workers = await Promise.allSettled(
    Array.from(
      { length: Math.min(questionConcurrency, results.length) },
      async () => {
        for (;;) {
          const index = next++
          if (index >= results.length) return
          const question = scenario.questions[index]
          const questionStorage = await createQuestionStorage(question.id)
          const questionClock = createClock(clock.now())
          const reopened = await openFamiliar({
            storage: questionStorage,
            ...options,
            now: questionClock.now,
            setTimer: questionClock.setTimer,
          })
          try {
            const prior = (await entriesAfter(questionStorage)).at(-1)?.id
            await reopened.send({
              author: 'Rowan',
              text: question.text,
              requestId: `eval:question:${question.id}`,
            })
            await waitForIdle(
              reopened,
              questionClock,
              nextUpkeep(questionClock.now()),
              `Question ${question.id}`,
            )
            const entries = await entriesAfter(questionStorage, prior)
            const answer = entries
              .filter((entry) => entry.kind === 'pi.assistant')
              .map((entry) => saidBy(entry)?.text)
              .filter(Boolean)
              .at(-1)
            if (!answer)
              throw new Error(`No assistant answer for ${question.id}.`)
            const messages = entries.flatMap((entry) => entry.model ?? [])
            const toolCalls = messages.flatMap((message) =>
              message.role === 'assistant'
                ? message.content.flatMap((part) =>
                    part.type === 'toolCall'
                      ? [
                          {
                            id: part.id,
                            name: part.name,
                            arguments: part.arguments,
                            result: messages.find(
                              (message) =>
                                message.role === 'toolResult' &&
                                message.toolCallId === part.id,
                            ),
                          },
                        ]
                      : [],
                  )
                : [],
            )
            const verdict = await judgeAnswer(models, model, question, answer)
            results[index] = { ...question, answer, verdict, toolCalls }
            progress(`${question.id}: ${verdict.pass ? 'pass' : 'fail'}`)
          } finally {
            await reopened.close()
          }
        }
      },
    ),
  )
  const failed = workers.find((worker) => worker.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
  return {
    scenario: scenario.id,
    days: scenario.days.length,
    judgeIsTestModel: true,
    memory,
    compactions,
    upkeep,
    results,
  }
}
