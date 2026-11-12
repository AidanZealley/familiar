import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { parseArgs } from 'node:util'
import { readFixture } from './core-fixture.ts'
import {
  DEFAULT_MAX_TOKENS,
  EVAL_MODEL,
  evalModels,
  readApiKey,
} from './model.ts'
import { percent, row, saveResult } from './results.ts'
import { runUseEval, type Rate, type UseGrade, type UseMeasure } from './use.ts'
import { probes } from './use-probes.ts'

const { values } = parseArgs({
  options: {
    probe: { type: 'boolean', default: false },
    model: { type: 'string', default: EVAL_MODEL },
    'max-tokens': { type: 'string', default: String(DEFAULT_MAX_TOKENS) },
    'from-fixture': { type: 'string' },
  },
})
const maxTokens = Number(values['max-tokens'])
if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
  throw new Error('--max-tokens must be a positive whole number.')
}

/** The saved replay named `core-<hash>.json`; `readFixture` finds it under eval/fixtures. */
function loadFixture(path: string) {
  const hash = /^core-(\w+)\.json$/.exec(basename(path))?.[1]
  const fixture = hash && readFixture(hash)
  if (!fixture) {
    throw new Error(
      `No saved eval:core fixture for ${path}; expected eval/fixtures/core-<hash>.json.`,
    )
  }
  return fixture
}

const seconds = (ms: number) => `${Math.round(ms / 1000)}s`
const report = (measure: UseMeasure) =>
  console.log(
    `${measure.runs} runs: ${measure.tokens.total.toLocaleString()} tokens (input ${measure.tokens.input.toLocaleString()}, output ${measure.tokens.output.toLocaleString()}, cache read ${measure.tokens.cacheRead.toLocaleString()}, cache write ${measure.tokens.cacheWrite.toLocaleString()}) in ${seconds(measure.elapsedMs)}.\nProjected for the whole run: ${measure.projectedTokens.toLocaleString()} tokens, ${seconds(measure.projectedMs)}; cap ${maxTokens.toLocaleString()}.`,
  )

function printGrade(grade: UseGrade) {
  const cell = ({ passed, total }: Rate) =>
    `${passed}/${total} ${percent(passed, total)}`
  console.log(`\n${row(['Grade', 'Value'])}`)
  for (const [name, value] of [
    ['Proactive, mem', cell(grade.proactive.with)],
    ['Proactive, none', cell(grade.proactive.without)],
    ['Memory gain', `${Math.round(grade.proactive.gain * 100)} pts`],
    ['Restraint', cell(grade.restraint)],
    ['Attribution', cell(grade.attribution)],
    ['Model', grade.model],
    ['Tokens', grade.tokens.total.toLocaleString()],
    ['Time', seconds(grade.elapsedMs)],
  ] as const) {
    console.log(row([name, value]))
  }
  for (const outcome of grade.outcomes.filter((outcome) => !outcome.passed)) {
    const why = [
      outcome.answered ? '' : 'stayed quiet',
      outcome.missing ? 'missing required' : '',
      outcome.forbidden.length ? `said ${outcome.forbidden.join(', ')}` : '',
    ].filter(Boolean)
    console.log(
      `  fail ${outcome.probe} (${outcome.memory ? 'with' : 'without'} memory): ${why.join('; ')}`,
    )
  }
  if (grade.skipped.length) {
    console.log(`  not covered by the fixture: ${grade.skipped.join(', ')}`)
  }
}

// Before anything else, so a missing key never gets as far as the network.
let apiKey: string
try {
  apiKey = readApiKey()
} catch (error) {
  console.error((error as Error).message)
  process.exit(1)
}

const fixture = values['from-fixture']
  ? loadFixture(values['from-fixture'])
  : undefined
const { models, model, meter } = evalModels({
  apiKey,
  modelId: values.model,
  maxTokens,
})
const directory = mkdtempSync(join(tmpdir(), 'familiar-use-eval-'))
try {
  const run = await runUseEval({
    probes,
    fixture,
    models,
    chat: model,
    meter,
    directory,
    probe: values.probe,
    progress: console.log,
  })
  if (run.measure) {
    report(run.measure)
  }
  if (run.status === 'stopped') {
    console.log(
      `${run.reason} ${run.tokens.total.toLocaleString()} tokens used.`,
    )
    process.exitCode = values.probe ? 0 : 1
  } else {
    printGrade(run.grade)
    console.log(
      `\nSaved ${saveResult(fixture ? 'use-fixture' : 'use', run.grade)}`,
    )
  }
} finally {
  rmSync(directory, { recursive: true, force: true })
}
