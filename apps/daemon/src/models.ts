import type { CredentialStore, Models } from '@earendil-works/pi-ai'
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { googleProvider } from '@earendil-works/pi-ai/providers/google'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'
import { xaiProvider } from '@earendil-works/pi-ai/providers/xai'
import type { ModelChoice } from '@familiar-ai/core'
import { createModels } from '@familiar-ai/core/models'
import { fileCredentialStore } from '@familiar-ai/core/node'
import { config, dataPath } from './config.ts'

// Pi loads its sign-in flows through a dynamic import a bundler can't follow.
// Registering them statically puts them in the release bundle. Pi names this
// for its Bun binary, but it is plain static imports.
registerBunOAuthFlows()

/**
 * The providers whose models `config.modelChoices` offers. OpenAI is reached
 * by signing in to ChatGPT; the rest by an API key saved in settings.
 */
export function providerModels(credentials?: CredentialStore) {
  const models = createModels({ credentials })
  for (const provider of [
    openaiProvider(),
    anthropicProvider(),
    googleProvider(),
    xaiProvider(),
    openrouterProvider(),
  ]) {
    models.setProvider(provider)
  }
  return models
}

/** The installation's models, with credentials encrypted in its data directory. */
export const openModels = () =>
  providerModels(
    fileCredentialStore(dataPath('auth.json'), dataPath('vault.key')),
  )

/**
 * The model choices whose provider has a credential, and the default chat
 * model: the configured OpenAI model if it's offered, else the first. With
 * no credentials, ChatGPT's choices, so the owner can sign in. Read at
 * startup, so a key saved or removed applies after a restart.
 */
export async function offeredModels(
  models: Pick<Models, 'checkAuth'>,
  choices: readonly ModelChoice[] = config.modelChoices,
  preferred = config.explicit.model,
) {
  const offered: ModelChoice[] = []
  for (const choice of choices) {
    if (await models.checkAuth(choice.model.provider)) {
      offered.push(choice)
    }
  }
  const modelChoices = offered.length
    ? offered
    : choices.filter(({ model }) => model.provider === 'openai')
  const chatModel = (
    modelChoices.find(
      ({ model }) => model.provider === 'openai' && model.modelId === preferred,
    ) ?? modelChoices[0]
  ).model
  return { modelChoices, chatModel }
}
