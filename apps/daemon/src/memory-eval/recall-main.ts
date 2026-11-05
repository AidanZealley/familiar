import { PADDING_YEARS, runRecallEval } from './recall.ts'
import { percent, row, saveResult } from './results.ts'
import { categories, rowanV3 } from './scenario.ts'

const result = runRecallEval(rowanV3)

console.log(
  `Skipped ${result.skipped.length} required strings found nowhere in ${result.scenario}:`,
)
for (const { question, required } of result.skipped) {
  console.log(`  ${question}: ${required}`)
}

for (const k of [5, 10] as const) {
  console.log(`\nRecall@${k}`)
  console.log(
    row(['Category', ...PADDING_YEARS.map((years) => `${years} years`)]),
  )
  for (const category of [...categories, 'all'] as const) {
    console.log(
      row([
        category,
        ...PADDING_YEARS.map((years) => {
          const scores = result.scores.filter(
            (score) =>
              score.years === years &&
              (category === 'all' || score.category === category),
          )
          const sum = (key: 'required' | 'at5' | 'at10') =>
            scores.reduce((total, score) => total + score[key], 0)
          return percent(sum(k === 5 ? 'at5' : 'at10'), sum('required'))
        }),
      ]),
    )
  }
}

console.log(
  `\n${row(['Padding', 'Exchanges', 'Build ms', 'Median ms', 'Max ms'])}`,
)
for (const years of PADDING_YEARS) {
  console.log(
    row([
      `${years} years`,
      String(result.exchanges[years]),
      result.buildMs[years].toFixed(0),
      result.search[years].medianMs.toFixed(1),
      result.search[years].maxMs.toFixed(1),
    ]),
  )
}

console.log(`
Saved ${saveResult('recall', result)}`)
