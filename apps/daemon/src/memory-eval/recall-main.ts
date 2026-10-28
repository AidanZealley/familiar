import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { categories } from './scenario.ts'
import { PADDING_YEARS, runRecallEval } from './recall.ts'
import { rowanV3 } from './scenario.ts'

const commit = execFileSync('git', ['describe', '--always', '--dirty'], {
  encoding: 'utf8',
  cwd: resolve(import.meta.dirname, '../../../..'),
}).trim()

const result = runRecallEval(rowanV3)

const percent = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : '-'
const row = (cells: string[]) =>
  cells
    .map((cell, index) => (index ? cell.padStart(10) : cell.padEnd(15)))
    .join('')

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

const date = new Date().toISOString().slice(0, 10)
const directory = resolve(import.meta.dirname, '../../../../eval/results')
mkdirSync(directory, { recursive: true })
const path = join(directory, `recall-${date}-${commit}.json`)
writeFileSync(path, `${JSON.stringify({ date, commit, ...result }, null, 2)}\n`)
console.log(`\nSaved ${path}`)
