import type { QuestionType } from './longmem-data.ts'
import type { Saved } from './longmem-run.ts'
import { addTokens, noTokens, type TokenTotals } from './model.ts'

/** The three stages tokens are reported by. */
export const STAGES = ['filing', 'reply', 'judge'] as const

const tokensOf = (saved: Saved, stage: (typeof STAGES)[number]) =>
  saved[stage]?.tokens.total ?? 0

/**
 * The tokens the questions left after `measured` will cost, if each costs
 * what the measured ones did at every stage. A stage a measured question
 * hasn't reached is left out of its mean, so a half-saved question doesn't
 * pull a mean down.
 */
export function projectTokens(measured: readonly Saved[], remaining: number) {
  const perStage = Object.fromEntries(
    STAGES.map((stage) => {
      const done = measured.filter((saved) => saved[stage])
      return [
        stage,
        done.length
          ? done.reduce((sum, saved) => sum + tokensOf(saved, stage), 0) /
            done.length
          : 0,
      ]
    }),
  ) as Record<(typeof STAGES)[number], number>
  const perQuestion = STAGES.reduce((sum, stage) => sum + perStage[stage], 0)
  return {
    perStage,
    perQuestion,
    total: Math.round(perQuestion * remaining),
  }
}

export type Summary = {
  questions: number
  correct: number
  /** Questions and right answers per type. */
  types: Partial<Record<QuestionType, { questions: number; correct: number }>>
  /** Tokens spent at each stage, summed over the questions. */
  tokens: Record<(typeof STAGES)[number], TokenTotals> & { total: TokenTotals }
}

/** Accuracy per type and overall, and the tokens each stage cost. Only judged questions count. */
export function summarise(records: readonly Saved[]): Summary {
  const judged = records.filter((saved) => saved.judge)
  const types: Summary['types'] = {}
  for (const saved of judged) {
    const tally = (types[saved.type] ??= { questions: 0, correct: 0 })
    tally.questions++
    tally.correct += Number(saved.judge!.correct)
  }
  const stage = (name: (typeof STAGES)[number]) =>
    records.reduce(
      (sum, saved) => addTokens(sum, saved[name]?.tokens ?? noTokens()),
      noTokens(),
    )
  const tokens = {
    filing: stage('filing'),
    reply: stage('reply'),
    judge: stage('judge'),
  }
  return {
    questions: judged.length,
    correct: judged.filter((saved) => saved.judge!.correct).length,
    types,
    tokens: {
      ...tokens,
      total: addTokens(addTokens(tokens.filing, tokens.reply), tokens.judge),
    },
  }
}
