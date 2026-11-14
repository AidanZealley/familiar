import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  ensureDataset,
  evalDirectory,
  FILLERS,
  idsOf,
  questionOf,
  readDataset,
  type QuestionSet,
} from './longmem-data.ts'
import { CONTEXT_BUDGET } from './longmem-history.ts'
import { STAGES, summarise } from './longmem-report.ts'
import { codeHash, keyOf, openRun, reuse, RunMismatch } from './longmem-run.ts'
import { runSet } from './longmem-set.ts'
import { readSets } from './longmem-sets.ts'
import {
  DEFAULT_MAX_TOKENS,
  evalAccess,
  MEMORY_MODEL,
  REPLY_MODEL,
} from './model.ts'
import { percent, saveResult } from './results.ts'

const { values } = parseArgs({
  options: {
    set: { type: 'string', default: 'dev' },
    'small-haystack': { type: 'boolean', default: false },
    model: { type: 'string', default: REPLY_MODEL },
    'memory-model': { type: 'string', default: MEMORY_MODEL },
    judge: { type: 'string' },
    'max-tokens': { type: 'string', default: String(DEFAULT_MAX_TOKENS) },
    parallel: { type: 'string', default: '4' },
    wait: { type: 'boolean', default: false },
    'projection-only': { type: 'boolean', default: false },
    run: { type: 'string' },
    reask: { type: 'string' },
    rejudge: { type: 'string' },
    fresh: { type: 'boolean', default: false },
  },
})
const whole = (name: string, text: string) => {
  const value = Number(text)
  if (!(value > 0) || !Number.isInteger(value)) {
    throw new Error(`--${name} must be a positive whole number.`)
  }
  return value
}
const set = values.set as QuestionSet
if (!['dev', 'holdout', 'milestone', 'full'].includes(set)) {
  throw new Error('--set must be dev, holdout, milestone or full.')
}
const maxTokens = whole('max-tokens', values['max-tokens'])
const parallel = whole('parallel', values.parallel)
const haystack = values['small-haystack'] ? 'small' : 'full'
const count = (tokens: number) => Math.round(tokens).toLocaleString()

// Before anything else, so a missing sign-in never gets as far as the network.
let access: ReturnType<typeof evalAccess>
try {
  access = evalAccess({
    model: values.model,
    memoryModel: values['memory-model'],
    judge: values.judge,
  })
} catch (error) {
  console.error((error as Error).message)
  process.exit(1)
}

const entries = await readDataset(await ensureDataset(undefined, console.log))
const ids = idsOf(set, readSets(entries), entries)
const byId = new Map(entries.map((entry) => [entry.question_id, entry]))

const runDirectory = (name: string) => join(evalDirectory(), 'longmem', name)
let run: ReturnType<typeof openRun>
try {
  // --reask <run>: reuse that run's filing, so only replies and verdicts
  // run. --rejudge <run>: reuse its filing and replies, so only verdicts do.
  if (values.reask && values.rejudge) {
    throw new RunMismatch('Pass --reask or --rejudge, not both.')
  }
  const from = values.rejudge ?? values.reask
  const through = values.rejudge ? 'reply' : 'filing'
  const source = from && runDirectory(from)
  const sourceKey = source ? keyOf(source) : undefined
  if (
    sourceKey &&
    (sourceKey.set !== set ||
      sourceKey.haystack !== haystack ||
      sourceKey.models.memory !== access.names.memory ||
      (through === 'reply' && sourceKey.models.reply !== access.names.reply))
  ) {
    throw new RunMismatch(
      `${source} was made for another set, haystack or model, so its ${through === 'reply' ? 'filing and replies' : 'filing'} can't be reused here.`,
    )
  }
  run = openRun(
    runDirectory(
      values.run ??
        (from
          ? `${from}-re${through === 'reply' ? 'judge' : 'ask'}`
          : `${set}-${haystack}`),
    ),
    {
      set,
      haystack,
      models: access.names,
      code: codeHash(),
      ...(sourceKey && {
        reused: { code: sourceKey.reused?.code ?? sourceKey.code, through },
      }),
    },
    { fresh: values.fresh },
  )
  if (source && sourceKey) {
    reuse(openRun(source, sourceKey), run, through)
  }
} catch (error) {
  if (error instanceof RunMismatch) {
    console.error(error.message)
    process.exit(1)
  }
  throw error
}

const scratch = mkdtempSync(join(tmpdir(), 'familiar-longmem-'))
const started = Date.now()
try {
  const outcome = await runSet({
    ids,
    question: (id) =>
      questionOf(byId.get(id)!, {
        small: haystack === 'small' ? FILLERS : undefined,
      }),
    run,
    access,
    maxTokens,
    parallel,
    wait: values.wait,
    projectionOnly: values['projection-only'],
    scratch,
    command: `pnpm eval:longmem ${process.argv.slice(2).join(' ')}`.trim(),
    log: console.log,
  })
  // 2: a limit stopped it and a rerun carries on. 1: over the cap.
  process.exitCode = { done: 0, projected: 0, limit: 2, 'over-cap': 1 }[
    outcome.status
  ]

  if (outcome.status === 'done') {
    const records = ids.map((id) => run.read(id)!)
    const summary = summarise(records)
    console.log(
      `\n${access.names.reply} replying, ${access.names.memory} filing, ${access.names.judge} judging; ${set} set, ${haystack} haystacks.\n`,
    )
    for (const [type, tally] of Object.entries(summary.types)) {
      console.log(
        `${type.padEnd(28)}${percent(tally.correct, tally.questions).padStart(5)}  (${tally.correct}/${tally.questions})`,
      )
    }
    console.log(
      `${'Overall'.padEnd(28)}${percent(summary.correct, summary.questions).padStart(5)}  (${summary.correct}/${summary.questions})`,
    )
    console.log('\nTokens by stage:')
    for (const stage of STAGES) {
      const tokens = summary.tokens[stage]
      console.log(
        `  ${stage.padEnd(8)}${count(tokens.total).padStart(14)} (input ${count(tokens.input)}, output ${count(tokens.output)}, cache read ${count(tokens.cacheRead)}, cache write ${count(tokens.cacheWrite)})`,
      )
    }
    console.log(
      `  ${'total'.padEnd(8)}${count(summary.tokens.total.total).padStart(14)}; this command used ${count(outcome.used)} in ${((Date.now() - started) / 60_000).toFixed(1)} min.`,
    )
    console.log(
      `\nSaved ${saveResult('longmem', {
        set,
        haystack,
        models: access.names,
        contextBudget: CONTEXT_BUDGET,
        code: codeHash(),
        summary,
        outcomes: records,
      })}`,
    )
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  console.error(
    `${ids.filter((id) => run.read(id)?.judge).length} of ${ids.length} finished and saved; rerun the same command to continue.`,
  )
  process.exitCode = 1
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
