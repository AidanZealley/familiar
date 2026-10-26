import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createModels } from '@earendil-works/pi-ai/models'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { fileCredentialStore } from '../credentials.ts'
import { runMemoryEval, summarize } from './run.ts'
import { memoryScenario } from './scenario.ts'

// This command deliberately never imports config.ts: that module creates the
// owner's data directory as a side effect when FAMILIAR_DATA_DIR is unset.
const evalDataDir = resolve(homedir(), '.local/share/familiar-eval')
const authPath = join(evalDataDir, 'auth.json')
const credentials = fileCredentialStore(authPath)
if (!existsSync(authPath) || !(await credentials.read('openai'))) {
  throw new Error(
    `Memory eval needs its own ChatGPT sign-in. Run FAMILIAR_DATA_DIR=${evalDataDir} pnpm sign-in first.`,
  )
}
const models = createModels({ credentials })
models.setProvider(openaiProvider())
const model = {
  provider: 'openai',
  modelId: process.env.FAMILIAR_MODEL ?? 'gpt-6.1-sol',
}
if (!models.getModel(model.provider, model.modelId))
  throw new Error(
    `Unknown eval model ${model.modelId}; set FAMILIAR_MODEL to a catalog model.`,
  )

const commit = execFileSync('git', ['describe', '--always', '--dirty'], {
  encoding: 'utf8',
  cwd: resolve(import.meta.dirname, '../../../..'),
}).trim()

const temporary = mkdtempSync(join(tmpdir(), 'familiar-memory-eval-'))
try {
  const replayPath = join(temporary, 'familiar.sqlite')
  const result = await runMemoryEval({
    storage: await openNodeSqliteStorage(replayPath),
    createQuestionStorage: async (id) => {
      const path = join(temporary, `question-${id}.sqlite`)
      if (existsSync(`${replayPath}-wal`))
        throw new Error(
          'Replay storage still has a WAL file after close; refusing to copy an unchecked database.',
        )
      copyFileSync(replayPath, path)
      return openNodeSqliteStorage(path)
    },
    models,
    model,
    scenario: memoryScenario,
    progress: console.log,
  })
  console.log('\nCategory        Passed  Total')
  for (const { category, passed, total } of summarize(result.results)) {
    console.log(
      `${category.padEnd(15)} ${String(passed).padStart(6)}  ${String(total).padStart(5)}`,
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
