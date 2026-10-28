import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { evalDataDir, judge, model, models } from './models.ts'
import { summarize, type QuestionResult } from './questions.ts'
import { runMemoryEval } from './run.ts'
import { rowanV3 } from './scenario.ts'

const commit = execFileSync('git', ['describe', '--always', '--dirty'], {
  encoding: 'utf8',
  cwd: resolve(import.meta.dirname, '../../../..'),
}).trim()

// The replay is kept in a run directory, never deleted, so a run stopped
// partway (a usage limit, a crash) continues with --resume <directory>.
const resumeAt = process.argv.indexOf('--resume')
const resume = resumeAt !== -1
const runDirectory = resume
  ? resolve(process.argv[resumeAt + 1] ?? '')
  : join(
      evalDataDir,
      'runs',
      `${new Date().toISOString().slice(0, 19)}-${commit}`,
    )
const replayPath = join(runDirectory, 'familiar.sqlite')
if (resume && !existsSync(replayPath)) {
  throw new Error(`No replay to resume in ${runDirectory}.`)
}
mkdirSync(runDirectory, { recursive: true })
console.log(`Replay storage: ${runDirectory}`)

// Graded answers are kept as they come in, so a resumed run asks only the
// questions it hasn't graded.
const answersPath = join(runDirectory, 'answers.jsonl')
const previous: QuestionResult[] =
  resume && existsSync(answersPath)
    ? readFileSync(answersPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as QuestionResult)
    : []
if (previous.length) {
  console.log(`Keeping ${previous.length} graded answers.`)
}

// Question copies are throwaway.
const temporary = mkdtempSync(join(tmpdir(), 'familiar-memory-eval-'))
try {
  const result = await runMemoryEval({
    storage: await openNodeSqliteStorage(replayPath),
    resume,
    previous,
    onAnswer: (result) =>
      appendFileSync(answersPath, `${JSON.stringify(result)}\n`),
    createQuestionStorage: async (id) => {
      const path = join(temporary, `question-${id}.sqlite`)
      if (existsSync(`${replayPath}-wal`)) {
        throw new Error(
          'Replay storage still has a WAL file after close; refusing to copy an unchecked database.',
        )
      }
      copyFileSync(replayPath, path)
      return openNodeSqliteStorage(path)
    },
    models,
    model,
    judge,
    scenario: rowanV3,
    progress: console.log,
  })
  console.log('\nCategory        Passed  Total')
  for (const { category, passed, total } of summarize(result.results)) {
    console.log(
      `${category.padEnd(15)} ${String(passed).padStart(6)}  ${String(total).padStart(5)}`,
    )
  }
  console.log('\nTokens          Input  Cached  Output')
  for (const [phase, tokens] of Object.entries(result.tokens)) {
    console.log(
      `${phase.padEnd(9)} ${[tokens.input, tokens.cacheRead, tokens.output]
        .map((count) => count.toLocaleString('en-GB').padStart(10))
        .join('')}`,
    )
  }
  const date = new Date().toISOString().slice(0, 10)
  const directory = resolve(import.meta.dirname, '../../../../eval/results')
  mkdirSync(directory, { recursive: true })
  const path = join(directory, `${date}-${commit}.json`)
  writeFileSync(
    path,
    `${JSON.stringify({ date, commit, model: model.modelId, ...result }, null, 2)}\n`,
  )
  console.log(`\nSaved ${path}`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
