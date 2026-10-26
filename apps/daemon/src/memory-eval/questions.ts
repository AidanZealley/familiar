import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Models } from '@earendil-works/pi-ai'
import type { ModelRef, Storage } from '@earendil-works/pi-durable'
import { summonFamiliar, type Familiar } from '@familiar/core'
import { nextUpkeep, saidBy } from '@familiar/core/diagnostics'
import { createClock } from './clock.ts'
import { judgeAnswer, type Verdict } from './judge.ts'
import {
  categories,
  type Category,
  type Question,
  type Scenario,
} from './scenario.ts'
import { entriesAfter } from './storage.ts'
import { waitForIdle } from './wait.ts'

const context = BACKGROUND_CONTEXT

export type QuestionResult = Question & {
  answer: string
  verdict: Verdict
  toolCalls: { id: string; name: string; arguments: unknown; result: unknown }[]
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

export async function askQuestions({
  createQuestionStorage,
  models,
  model,
  scenario,
  progress,
  questionConcurrency,
  now,
}: {
  createQuestionStorage: (id: string) => Promise<Storage>
  models: Models
  model: ModelRef
  scenario: Scenario
  progress: (message: string) => void
  questionConcurrency: number
  now: number
}): Promise<QuestionResult[]> {
  const options = { models, model, contextBudget: 4_000 }
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
          const questionClock = createClock(now)
          let reopened: Familiar
          try {
            reopened = await summonFamiliar({
              storage: questionStorage,
              ...options,
              now: questionClock.now,
              setTimer: questionClock.setTimer,
            })
          } catch (error) {
            await questionStorage.close(context)
            throw error
          }
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
            await reopened.dismiss()
          }
        }
      },
    ),
  )
  const failed = workers.find((worker) => worker.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
  return results
}
