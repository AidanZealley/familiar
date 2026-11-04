import { summonFamiliar } from '@familiar-ai/core'
import { credentials, publicOnlyFetch, secrets, storage } from './host.ts'
import { createModels } from '@familiar-ai/core/models'
import { openaiProvider } from '@familiar-ai/core/models/openai'
import { greeting } from './plugin.ts'

const models = createModels({ credentials })
models.setProvider(openaiProvider())

export const familiar = await summonFamiliar({
  storage,
  models,
  model: { provider: 'openai', modelId: 'gpt-6.1-sol' },
  timeZone: 'Europe/London',
  name: 'Willow',
  persona:
    'You are Willow, a helpful assistant for a family kitchen. Replies render as Markdown.',
  plugins: [greeting],
  secrets,
  fetch: publicOnlyFetch,
})
