import { openWorkspace } from '@familiar-ai/core'
import { credentials, publicOnlyFetch, secrets, storage } from './host.ts'
import { createModels } from '@familiar-ai/core/models'
import { openaiProvider } from '@familiar-ai/core/models/openai'
import { greeting } from './plugin.ts'

const models = createModels({ credentials })
models.setProvider(openaiProvider())

export const workspace = await openWorkspace({
  storage,
  models,
  model: { provider: 'openai', modelId: 'gpt-6.1-sol' },
  timeZone: 'Europe/London',
  hostInstructions: 'Replies render as Markdown.',
  plugins: [greeting],
  secrets,
  fetch: publicOnlyFetch,
})

// Who it is lives in the workspace, so this runs once, on the first open.
if (!(await workspace.familiars.list()).length) {
  await workspace.familiars.create({
    name: 'Willow',
    persona: 'You are Willow, a helpful assistant for a family kitchen.',
  })
}
