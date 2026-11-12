import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { replayCore, type Measure } from './core.ts'
import {
  coreHash,
  fixturePath,
  readFixture,
  writeFixture,
} from './core-fixture.ts'
import { gradeCore, type CoreGrade, type Placed } from './core-grade.ts'
import { mayaV1 } from './core-scenario.ts'
import {
  DEFAULT_MAX_TOKENS,
  EVAL_MODEL,
  evalModels,
  readApiKey,
  upkeepModel,
} from './model.ts'
import { percent, row, saveResult } from './results.ts'

const { values } = parseArgs({
  options: {
    probe: { type: 'boolean', default: false },
    model: { type: 'string', default: EVAL_MODEL },
    'max-tokens': { type: 'string', default: String(DEFAULT_MAX_TOKENS) },
  },
})
const maxTokens = Number(values['max-tokens'])
if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
  throw new Error('--max-tokens must be a positive whole number.')
}
const scenario = mayaV1
const hash = coreHash(scenario, upkeepModel(values.model))

const seconds = (ms: number) => `${Math.round(ms / 1000)}s`
const report = (measure: Measure) =>
  console.log(
    `${measure.activeDays} active days: ${measure.tokens.total.toLocaleString()} tokens (input ${measure.tokens.input.toLocaleString()}, output ${measure.tokens.output.toLocaleString()}, cache read ${measure.tokens.cacheRead.toLocaleString()}, cache write ${measure.tokens.cacheWrite.toLocaleString()}) in ${seconds(measure.elapsedMs)}.\nProjected for all ${scenario.days.length}: ${measure.projectedTokens.toLocaleString()} tokens, ${seconds(measure.projectedMs)}; cap ${maxTokens.toLocaleString()}.`,
  )

/** Replays the scenario on the model, returning its fixture, or undefined if it stopped. */
async function replay() {
  let apiKey: string
  try {
    // Before anything else, so a missing key never gets as far as the network.
    apiKey = readApiKey()
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 1
    return undefined
  }
  const { models, model, meter } = evalModels({
    apiKey,
    modelId: values.model,
    maxTokens,
  })
  const temporary = mkdtempSync(join(tmpdir(), 'familiar-core-eval-'))
  try {
    const replay = await replayCore(scenario, {
      models,
      memoryModel: model,
      meter,
      directory: temporary,
      probe: values.probe,
      progress: console.log,
    })
    if (replay.measure) {
      report(replay.measure)
    }
    if (replay.status === 'stopped') {
      console.log(
        `${replay.reason} ${replay.tokens.total.toLocaleString()} tokens used; no fixture saved.`,
      )
      process.exitCode = values.probe ? 0 : 1
      return undefined
    }
    console.log(`Saved ${writeFixture(replay.fixture)}`)
    return replay.fixture
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

const saved = readFixture(hash)
if (saved) {
  console.log(
    values.probe
      ? `${fixturePath(hash)} already holds this replay, so there is nothing to probe. Run without --probe to grade it.`
      : `Grading the saved replay ${fixturePath(hash)}; no model calls.`,
  )
}
// A probe never saves a fixture, so this grades only a full run or a saved one.
const fixture = saved ?? (await replay())
if (fixture && !values.probe) {
  printGrade(gradeCore(fixture))
}

function printGrade(grade: CoreGrade) {
  console.log(
    `\n${row(['Grade', 'Real', 'Pressure'])}\n${row(['Budget', String(grade.budget), String(grade.pressure.budget)])}`,
  )
  const both = (name: string, pick: (placed: Placed) => string) =>
    console.log(row([name, pick(grade), pick(grade.pressure)]))
  both('Core precision', (p) => percent(p.corePrecision, 1))
  both('Core recall', (p) => percent(p.coreRecall, 1))
  both('Recall in core', (p) => percent(p.recallInCore, 1))
  both('Fades out', (p) => percent(p.fadesOut, 1))
  both('Core facts', (p) => String(p.core.facts))
  both('Core chars', (p) => String(p.core.characters))
  both('Core tokens', (p) => String(p.core.tokens))
  for (const [name, value] of [
    ['Fades refreshed', percent(grade.fadesRefreshed, 1)],
    ['Junk rate', percent(grade.junkRate, 1)],
    ['Changes right', percent(grade.changesCorrect, 1)],
    ['Memory ratio', grade.memoryRatio.toFixed(2)],
    ['Facts/day', grade.factsPerActiveDay.toFixed(2)],
    ['Near dupes', String(grade.nearDuplicates.length)],
    ['Tokens', grade.tokens.total.toLocaleString()],
  ] as const) {
    console.log(row([name, value]))
  }
  for (const [name, placed] of [
    ['real', grade],
    ['pressure', grade.pressure],
  ] as const) {
    for (const item of placed.items.filter((item) => !item.placed)) {
      console.log(
        `  misplaced at ${name} budget, ${item.label} ${item.id}: stored ${item.stored.join(', ') || 'nowhere'}, in core ${item.inCore.join(', ') || 'none'}`,
      )
    }
  }
  console.log(`\nSaved ${saveResult('core', grade)}`)
}
