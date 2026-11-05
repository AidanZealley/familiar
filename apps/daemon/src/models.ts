import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth'
import { createModels } from '@familiar-ai/core/models'
import { openaiProvider } from '@familiar-ai/core/models/openai'
import { dataPath } from './config.ts'
import { fileCredentialStore } from './credentials.ts'

// Pi loads its sign-in flows through a dynamic import a bundler can't follow.
// Registering them statically puts them in the release bundle. Pi names this
// for its Bun binary, but it is plain static imports.
registerBunOAuthFlows()

/** Model access through your ChatGPT subscription; `pnpm sign-in` signs in. */
export function openModels() {
  const models = createModels({
    credentials: fileCredentialStore(dataPath('auth.json')),
  })
  models.setProvider(openaiProvider())
  return models
}
