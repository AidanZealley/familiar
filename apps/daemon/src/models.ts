import { createModels } from '@familiar-ai/core/models'
import { openaiProvider } from '@familiar-ai/core/models/openai'
import { dataPath } from './config.ts'
import { fileCredentialStore } from './credentials.ts'

/** Model access through your ChatGPT subscription; `pnpm sign-in` signs in. */
export function openModels() {
  const models = createModels({
    credentials: fileCredentialStore(dataPath('auth.json')),
  })
  models.setProvider(openaiProvider())
  return models
}
