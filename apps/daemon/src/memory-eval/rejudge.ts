import { readFileSync, writeFileSync } from 'node:fs'
import { judgeAnswer, transcriptOf } from './judge.ts'
import { judge, models } from './models.ts'
import { summarize, type QuestionResult } from './questions.ts'
import type { EvalResult } from './run.ts'
import { scenarios } from './scenario.ts'
import { addTokens, noTokens } from './tokens.ts'

// Grades a saved run's answers again with the current judge, so judge changes
// take a minute to check instead of a full replay.
const path = process.argv[2]
if (!path) throw new Error('Usage: pnpm eval:memory:rejudge <result.json>')
const saved = JSON.parse(readFileSync(path, 'utf8')) as EvalResult
const scenario = scenarios.find(({ id }) => id === saved.scenario)
if (!scenario)
  throw new Error(`${path} has unknown scenario ${saved.scenario}.`)
const transcript = transcriptOf(scenario)
const results: QuestionResult[] = await Promise.all(
  saved.results.map(async (result) => {
    const { verdict, usage } = await judgeAnswer(
      models,
      judge,
      transcript,
      result,
      result.answer,
    )
    if (verdict.pass !== result.verdict.pass)
      console.log(
        `${result.id}: ${result.verdict.pass ? 'pass' : 'fail'} -> ${verdict.pass ? 'pass' : 'fail'} (${verdict.reason})`,
      )
    return {
      ...result,
      verdict,
      tokens: { ...result.tokens, judge: addTokens(noTokens, usage) },
    }
  }),
)
console.log('\nCategory        Passed  Total')
for (const { category, passed, total } of summarize(results)) {
  console.log(
    `${category.padEnd(15)} ${String(passed).padStart(6)}  ${String(total).padStart(5)}`,
  )
}
const out = path.replace(/\.json$/, `.rejudged.json`)
writeFileSync(
  out,
  `${JSON.stringify(
    {
      ...saved,
      judge: judge.modelId,
      ...(saved.tokens && {
        tokens: {
          ...saved.tokens,
          judge: results
            .map(({ tokens }) => tokens.judge)
            .reduce(addTokens, noTokens),
        },
      }),
      results,
    },
    null,
    2,
  )}\n`,
)
console.log(`\nSaved ${out}`)
