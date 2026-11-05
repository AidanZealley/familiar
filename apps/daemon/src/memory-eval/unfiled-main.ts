import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { percent, row, saveResult } from './results.ts'
import { categories, rowanV3 } from './scenario.ts'
import { runUnfiledEval } from './unfiled.ts'

const temporary = mkdtempSync(join(tmpdir(), 'familiar-unfiled-eval-'))
try {
  const result = await runUnfiledEval(rowanV3, temporary, console.log)

  console.log(
    `\nSkipped ${result.skipped.length} required strings found nowhere in ${result.scenario}.`,
  )
  console.log(`Compactions during replay: ${result.compactions}`)
  console.log(
    `\n${row(['Category', 'Required', 'In note', 'In view', 'Only note'])}`,
  )
  for (const category of [...categories, 'all'] as const) {
    const scores = result.scores.filter(
      (score) => category === 'all' || score.category === category,
    )
    const sum = (key: 'required' | 'inNote' | 'inView' | 'onlyInNote') =>
      scores.reduce((total, score) => total + score[key], 0)
    console.log(
      row([
        category,
        String(sum('required')),
        percent(sum('inNote'), sum('required')),
        percent(sum('inView'), sum('required')),
        percent(sum('onlyInNote'), sum('required')),
      ]),
    )
  }
  console.log(
    `\nRecall note tokens: median ${result.noteTokens.median}, max ${result.noteTokens.max}`,
  )

  console.log(`\nSaved ${saveResult('unfiled', result)}`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
