import { createModels } from '@earendil-works/pi-ai/models'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
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
