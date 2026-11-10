import { openWorkspace } from '@familiar-ai/core'
import { createModels } from '@familiar-ai/core/models'
import { openaiProvider } from '@familiar-ai/core/models/openai'
import { credentials, deviceId, storage } from './host.ts'

const models = createModels({ credentials })
models.setProvider(openaiProvider())

export const workspace = await openWorkspace({
  storage,
  models,
  account: { login: { getDeviceId: deviceId, agentName: 'Familiar' } },
  model: { provider: 'openai', modelId: 'gpt-6.1-sol' },
  chatModels: [
    {
      model: { provider: 'openai', modelId: 'gpt-6.1-sol' },
      thinkingLevel: 'low',
    },
    {
      model: { provider: 'openai', modelId: 'gpt-6-luna' },
      thinkingLevel: 'medium',
    },
  ],
  timeZone: 'Europe/London',
})
