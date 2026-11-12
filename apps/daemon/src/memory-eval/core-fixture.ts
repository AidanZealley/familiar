import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ModelChoice } from '@familiar-ai/core'
import type {
  EpisodesState,
  FactsState,
  MemoryUsageState,
} from '@familiar-ai/core/diagnostics'
import type { CoreScenario } from './core-scenario.ts'
import type { TokenTotals } from './model.ts'

/**
 * The saved end state of an eval:core replay, and the only code that reads
 * or writes it. A replay is keyed by everything that decides what upkeep
 * writes, so grading reruns free until one of those changes.
 */

export type CoreFixture = {
  scenario: string
  /** See `coreHash`. */
  hash: string
  /** Upkeep's model and level, `provider/modelId@level`. */
  model: string
  facts: FactsState
  usage: MemoryUsageState
  episodes: EpisodesState
  /** The eval clock when the replay ended, in ms. */
  clock: number
  /** What the replay's model calls used. */
  tokens: TokenTotals
  /** Real time the replay took. */
  elapsedMs: number
}

const root = resolve(import.meta.dirname, '../../../..')
const upkeepDirectory = join(root, 'packages/core/src/memory/upkeep')
const fixtures = join(root, 'eval/fixtures')

export const modelName = ({ model, thinkingLevel }: ModelChoice) =>
  `${model.provider}/${model.modelId}@${thinkingLevel}`

/**
 * What decides what upkeep writes: its prompts, its tools, what the
 * scenario says and the model. Ranking isn't here, since grading re-runs it,
 * nor are the scenario's labels and match strings, which only grading reads.
 * Whole files, so an edit to either, even a comment, means a new replay.
 */
export function coreHash(scenario: CoreScenario, model: ModelChoice) {
  const hash = createHash('sha256')
  for (const file of ['prompts.ts', 'tools.ts']) {
    hash.update(readFileSync(join(upkeepDirectory, file)))
  }
  const { id, owner, other, start, end, days } = scenario
  hash.update(
    JSON.stringify([
      id,
      owner,
      other,
      start,
      end,
      days.map(({ date, messages }) => [
        date,
        messages.map(({ by, in: room, text }) => [by, room, text]),
      ]),
    ]),
  )
  hash.update(modelName(model))
  return hash.digest('hex').slice(0, 12)
}

export const fixturePath = (hash: string) => join(fixtures, `core-${hash}.json`)

/** The fixture for `hash`, if a replay has saved one. */
export function readFixture(hash: string): CoreFixture | undefined {
  const path = fixturePath(hash)
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as CoreFixture)
    : undefined
}

/** Saves `fixture` for its hash, returning its path. */
export function writeFixture(fixture: CoreFixture) {
  mkdirSync(fixtures, { recursive: true })
  const path = fixturePath(fixture.hash)
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`)
  return path
}
