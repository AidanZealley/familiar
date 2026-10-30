import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { categories, rowanV3 } from './scenario.ts'
import { runUnfiledEval } from './unfiled.ts'

const commit = execFileSync('git', ['describe', '--always', '--dirty'], {
  encoding: 'utf8',
  cwd: resolve(import.meta.dirname, '../../../..'),
}).trim()

const temporary = mkdtempSync(join(tmpdir(), 'familiar-unfiled-eval-'))
try {
  const result = await runUnfiledEval(rowanV3, temporary, console.log)

  const percent = (part: number, whole: number) =>
    whole ? `${Math.round((part / whole) * 100)}%` : '-'
  const row = (cells: string[]) =>
    cells
      .map((cell, index) => (index ? cell.padStart(10) : cell.padEnd(15)))
      .join('')

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

  const date = new Date().toISOString().slice(0, 10)
  const directory = resolve(import.meta.dirname, '../../../../eval/results')
  mkdirSync(directory, { recursive: true })
  const path = join(directory, `unfiled-${date}-${commit}.json`)
  writeFileSync(
    path,
    `${JSON.stringify({ date, commit, ...result }, null, 2)}\n`,
  )
  console.log(`\nSaved ${path}`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
