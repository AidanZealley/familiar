import { expect, test, vi } from 'vitest'
import { offeredModels, providerModels } from './models.ts'

vi.mock('./config.ts', () => ({ config: { explicit: {} } }))

const choices = [
  { model: { provider: 'openai', modelId: 'sol' }, thinkingLevel: 'low' },
  { model: { provider: 'openai', modelId: 'luna' }, thinkingLevel: 'low' },
  { model: { provider: 'anthropic', modelId: 'opus' }, thinkingLevel: 'low' },
] as const
const withCredentials = (...providers: string[]) => ({
  checkAuth: async (provider: string) =>
    providers.includes(provider) ? { type: 'api_key' as const } : undefined,
})

test('offers the providers with credentials, else ChatGPT to sign in to', async () => {
  const anthropic = await offeredModels(withCredentials('anthropic'), choices)
  expect(anthropic.modelChoices).toEqual([choices[2]])
  expect(anthropic.chatModel).toEqual(choices[2].model)

  const none = await offeredModels(withCredentials(), choices)
  expect(none.modelChoices).toEqual([choices[0], choices[1]])

  // The configured OpenAI model, while it's offered.
  const both = await offeredModels(
    withCredentials('openai', 'anthropic'),
    choices,
    'luna',
  )
  expect(both.modelChoices).toEqual(choices)
  expect(both.chatModel).toEqual(choices[1].model)
})

// A typo or an unsupported level only shows when someone picks the model.
test('every model choice is in its provider catalogue at a level it supports', async () => {
  const { config } =
    await vi.importActual<typeof import('./config.ts')>('./config.ts')
  const models = providerModels()
  for (const { model, thinkingLevel } of config.modelChoices) {
    const found = models.getModel(model.provider, model.modelId)
    expect(found, `${model.provider}/${model.modelId}`).toBeDefined()
    expect(found?.thinkingLevelMap?.[thinkingLevel]).not.toBeNull()
  }
})
