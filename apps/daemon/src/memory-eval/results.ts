import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** The commit an eval ran at, marked dirty when the checkout had changes. */
const commit = execFileSync('git', ['describe', '--always', '--dirty'], {
  encoding: 'utf8',
  cwd: resolve(import.meta.dirname, '../../../..'),
}).trim()

/** Saves `result` as `eval/results/<name>-<date>-<commit>.json`, returning its path. */
export function saveResult(name: string, result: object) {
  const date = new Date().toISOString().slice(0, 10)
  const directory = resolve(import.meta.dirname, '../../../../eval/results')
  mkdirSync(directory, { recursive: true })
  const path = join(directory, `${name}-${date}-${commit}.json`)
  writeFileSync(
    path,
    `${JSON.stringify({ date, commit, ...result }, null, 2)}\n`,
  )
  return path
}

export const percent = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : '-'

/** A table row: a left-aligned label, then right-aligned columns. */
export const row = (cells: string[]) =>
  cells
    .map((cell, index) => (index ? cell.padStart(16) : cell.padEnd(20)))
    .join('')
