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
import { showShare } from './spread.ts'
import { runUseEval, type Rate, type UseGrade, type UseMeasure } from './use.ts'
import { probes } from './use-probes.ts'

const DEFAULT_REPEAT = 3
/** The cap when a probe runs more than once: about a million tokens at 30 probes. */
const REPEAT_MAX_TOKENS = 2_000_000

const { values } = parseArgs({
  options: {
    probe: { type: 'boolean', default: false },
    model: { type: 'string', default: EVAL_MODEL },
    repeat: { type: 'string', default: String(DEFAULT_REPEAT) },
    'max-tokens': { type: 'string' },
    'from-fixture': { type: 'string' },
  },
})
const repeat = Number(values.repeat)
if (!Number.isInteger(repeat) || repeat <= 0) {
  throw new Error('--repeat must be a positive whole number.')
}
// Repeats multiply the runs, so the cap they need is higher.
const maxTokens = Number(
  values['max-tokens'] ?? (repeat > 1 ? REPEAT_MAX_TOKENS : DEFAULT_MAX_TOKENS),
)
if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
  throw new Error('--max-tokens must be a positive whole number.')
}

/** The saved replay named `core-<hash>-<replay>.json`; `readFixture` finds it under eval/fixtures. */
function loadFixture(path: string) {
  const [, hash, replay] = /^core-(\w+)-(\d+)\.json$/.exec(basename(path)) ?? []
  const fixture = hash && readFixture(hash, Number(replay))
  if (!fixture) {
    throw new Error(
      `No saved eval:core fixture for ${path}; expected eval/fixtures/core-<hash>-<replay>.json.`,
    )
  }
  return fixture
}

const seconds = (ms: number) => `${Math.round(ms / 1000)}s`
const report = (measure: UseMeasure) =>
  console.log(
    `${measure.runs} runs: ${measure.tokens.total.toLocaleString()} tokens (input ${measure.tokens.input.toLocaleString()}, output ${measure.tokens.output.toLocaleString()}, cache read ${measure.tokens.cacheRead.toLocaleString()}, cache write ${measure.tokens.cacheWrite.toLocaleString()}) in ${seconds(measure.elapsedMs)}.\nProjected for the whole run: ${measure.projectedTokens.toLocaleString()} tokens, ${seconds(measure.projectedMs)}; cap ${maxTokens.toLocaleString()}.`,
  )

/** Each proactive probe's passes in each placement, to find the ones that are broken rather than telling. */
function printProbes({ outcomes }: UseGrade) {
  const proactive = outcomes.filter((outcome) => outcome.kind === 'proactive')
  console.log(`\n${row(['Probe', 'core', 'outside', 'none', 'recalled'])}`)
  for (const id of new Set(proactive.map((outcome) => outcome.probe))) {
    const mine = proactive.filter((outcome) => outcome.probe === id)
    // A fixture's facts keep the placement the replay gave them.
    const first = mine.some((outcome) => outcome.placement === 'core')
      ? 'core'
      : 'placed'
    const passes = (placement: string) => {
      const runs = mine.filter((outcome) => outcome.placement === placement)
      return `${runs.filter((outcome) => outcome.passed).length}/${runs.length}`
    }
    const outside = mine.filter((outcome) => outcome.placement === 'outside')
    console.log(
      row([
        id,
        passes(first),
        passes('outside'),
        passes('none'),
        outside.length ? (outside[0].recalled ? 'yes' : 'no') : '-',
      ]),
    )
  }
}

function printGrade(grade: UseGrade) {
  const cell = ({ passed, total }: Rate) =>
    `${passed}/${total} ${percent(passed, total)}`
  const { proactive } = grade
  console.log(
    `\n${proactive.probes} proactive probes, each run ${proactive.repeats} time${proactive.repeats === 1 ? '' : 's'} per placement. Rates are the mean (range) across repeats.`,
  )
  console.log(`\n${row(['Grade', 'Value'])}`)
  // Rescue sits beside "in core": it is defined over the probes that pass there.
  for (const [name, value] of [
    ['Proactive, core', showShare(proactive.with)],
    ['Rescue rate', showShare(proactive.rescue)],
    ['Proactive, out', showShare(proactive.outside)],
    ['Proactive, none', showShare(proactive.without)],
    ['Memory gain', showShare(proactive.gain)],
    ['Recall matched', showShare(proactive.recalled)],
    ['Model asked', showShare(proactive.asked)],
    ['Restraint', cell(grade.restraint)],
    ['Attribution', cell(grade.attribution)],
    ['Model', grade.model],
    ['Tokens', grade.tokens.total.toLocaleString()],
    ['Time', seconds(grade.elapsedMs)],
  ] as const) {
    console.log(row([name, value]))
  }
  printProbes(grade)
  for (const outcome of grade.outcomes.filter(
    (outcome) => !outcome.passed && outcome.kind !== 'proactive',
  )) {
    const why = [
      outcome.answered ? '' : 'stayed quiet',
      outcome.missing ? 'missing required' : '',
      outcome.forbidden.length ? `said ${outcome.forbidden.join(', ')}` : '',
    ].filter(Boolean)
    console.log(
      `  fail ${outcome.probe}${outcome.asked ? ' (asked memory)' : ''}: ${why.join('; ')}`,
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
    repeat,
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
