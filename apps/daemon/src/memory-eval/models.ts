import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createModels } from '@familiar-ai/core/models'
import { openaiProvider } from '@familiar-ai/core/models/openai'
import { fileCredentialStore } from '../credentials.ts'

// The eval signs in separately, so it never touches the owner's login.
export const evalDataDir = resolve(homedir(), '.local/share/familiar-eval')
const authPath = join(evalDataDir, 'auth.json')
const credentials = fileCredentialStore(authPath)
if (!existsSync(authPath) || !(await credentials.read('openai'))) {
  throw new Error(
    `Memory eval needs its own ChatGPT sign-in. Run FAMILIAR_DATA_DIR=${evalDataDir} pnpm sign-in first.`,
  )
}
export const models = createModels({ credentials })
models.setProvider(openaiProvider())
export const model = {
  provider: 'openai',
  modelId: process.env.FAMILIAR_MODEL ?? 'gpt-6.1-sol',
}
if (!models.getModel(model.provider, model.modelId)) {
  throw new Error(
    `Unknown eval model ${model.modelId}; set FAMILIAR_MODEL to a catalog model.`,
  )
}
// Scores are only comparable under the same judge. Change this deliberately,
// then re-record a baseline.
export const judge = {
  provider: 'openai',
  modelId: process.env.FAMILIAR_JUDGE_MODEL ?? 'gpt-6.1-sol',
}
if (!models.getModel(judge.provider, judge.modelId)) {
  throw new Error(
    `Unknown judge model ${judge.modelId}; set FAMILIAR_JUDGE_MODEL to a catalog model.`,
  )
}
