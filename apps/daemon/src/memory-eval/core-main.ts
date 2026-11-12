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
  type CoreFixture,
} from './core-fixture.ts'
import {
  gradeCore,
  summariseCore,
  type CoreSummary,
  type PlacedSummary,
} from './core-grade.ts'
import { mayaV1 } from './core-scenario.ts'
import {
  DEFAULT_MAX_TOKENS,
  EVAL_MODEL,
  evalModels,
  readApiKey,
  upkeepModel,
} from './model.ts'
import { row, saveResult } from './results.ts'
import { showNumber, showShare } from './spread.ts'

const { values } = parseArgs({
  options: {
    probe: { type: 'boolean', default: false },
    model: { type: 'string', default: EVAL_MODEL },
    replays: { type: 'string', default: '3' },
    'max-tokens': { type: 'string', default: String(DEFAULT_MAX_TOKENS) },
  },
})
const maxTokens = Number(values['max-tokens'])
if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
  throw new Error('--max-tokens must be a positive whole number.')
}
const replays = Number(values.replays)
if (!Number.isInteger(replays) || replays <= 0) {
  throw new Error('--replays must be a positive whole number.')
}
const scenario = mayaV1
const hash = coreHash(scenario, upkeepModel(values.model))

const seconds = (ms: number) => `${Math.round(ms / 1000)}s`
const report = (measure: Measure) =>
  console.log(
    `${measure.activeDays} active days: ${measure.tokens.total.toLocaleString()} tokens (input ${measure.tokens.input.toLocaleString()}, output ${measure.tokens.output.toLocaleString()}, cache read ${measure.tokens.cacheRead.toLocaleString()}, cache write ${measure.tokens.cacheWrite.toLocaleString()}) in ${seconds(measure.elapsedMs)}.\nProjected for all ${scenario.days.length}: ${measure.projectedTokens.toLocaleString()} tokens, ${seconds(measure.projectedMs)}; cap ${maxTokens.toLocaleString()} for this replay.`,
  )

/**
 * Replays the scenario as replay number `number` on the model, returning its
 * fixture, or undefined if it stopped. Each replay has its own meter and cap,
 * since its projection is made from its own first days.
 */
async function replay(number: number) {
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
    console.log(`Replay ${number} of ${replays}.`)
    const replay = await replayCore(scenario, {
      models,
      memoryModel: model,
      replay: number,
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

/** The replays' fixtures, running any that aren't saved yet; undefined if one stopped or this was a probe. */
async function fixtures() {
  const numbers = Array.from({ length: replays }, (_, index) => index + 1)
  const saved = numbers.map((number) => readFixture(hash, number))
  const missing = numbers.filter((_, index) => !saved[index])
  if (values.probe) {
    // A probe measures one replay's first days and saves nothing.
    console.log(
      missing.length
        ? `Probing replay ${missing[0]}; ${missing.length} of ${replays} replays are not saved.`
        : `${fixturePath(hash, 1)} and the other ${replays - 1} already hold these replays, so there is nothing to probe. Run without --probe to grade them.`,
    )
    if (missing.length) {
      await replay(missing[0])
    }
    return undefined
  }
  if (!missing.length) {
    console.log(
      `Grading the ${replays} saved replays of ${hash}; no model calls.`,
    )
  }
  const all: CoreFixture[] = []
  for (const [index, number] of numbers.entries()) {
    const fixture = saved[index] ?? (await replay(number))
    if (!fixture) {
      return undefined
    }
    all.push(fixture)
  }
  return all
}

function printSummary(summary: CoreSummary) {
  console.log(
    `\n${summary.replays} replays; mean (range across replays). Items per label: ${Object.entries(
      summary.labelled,
    )
      .map(([label, count]) => `${label} ${count}`)
      .join(', ')}.`,
  )
  console.log(
    `\n${row(['Grade', 'Real', 'Pressure'])}\n${row(['Budget', String(summary.real.budget), String(summary.pressure.budget)])}`,
  )
  const both = (name: string, pick: (placed: PlacedSummary) => string) =>
    console.log(row([name, pick(summary.real), pick(summary.pressure)]))
  both('Core precision', (p) => showShare(p.corePrecision))
  both('Core recall', (p) => showShare(p.coreRecall))
  both('Recall in core', (p) => showShare(p.recallInCore))
  both('Fades out', (p) => showShare(p.fadesOut))
  both('Core facts', (p) => showNumber(p.facts, 1))
  both('Core chars', (p) => showNumber(p.characters))
  both('Core tokens', (p) => showNumber(p.tokens))
  for (const [name, value] of [
    ['Fades refreshed', showShare(summary.fadesRefreshed)],
    ['Junk rate', showShare(summary.junkRate)],
    ['Changes right', showShare(summary.changesCorrect)],
    ['Memory ratio', showNumber(summary.memoryRatio, 2)],
    ['Facts/day', showNumber(summary.factsPerActiveDay, 2)],
    ['Near dupes', showNumber(summary.nearDuplicates, 1)],
    ['Tokens/replay', showNumber(summary.tokens)],
  ] as const) {
    console.log(row([name, value]))
  }
  for (const item of summary.missed) {
    console.log(
      `  ${item.label} ${item.id}: right in ${item.real}/${summary.replays} replays at the real budget, ${item.pressure}/${summary.replays} under pressure`,
    )
  }
}

const all = await fixtures()
if (all) {
  const grades = all.map((fixture) => gradeCore(fixture))
  const summary = summariseCore(grades)
  printSummary(summary)
  console.log(`\nSaved ${saveResult('core', { summary, grades })}`)
}
