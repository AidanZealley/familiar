import { toTranscript } from '@familiar-ai/client'
import { authorizeSingleOwner, summonFamiliar } from '@familiar-ai/core'
import { createModels } from '@familiar-ai/core/models'
import {
  fauxAssistantMessage,
  fauxProvider,
} from '@familiar-ai/core/models/faux'
import { MemoryStorage } from '@familiar-ai/core/storage/memory'

// A scripted model: no credentials, no network.
const faux = fauxProvider({ models: [{ id: 'demo' }] })
const models = createModels()
models.setProvider(faux.provider)
faux.setResponses([fauxAssistantMessage('Hello, Sam.')])

const familiar = await summonFamiliar({
  storage: new MemoryStorage(),
  models,
  model: { provider: 'faux', modelId: 'demo' },
  timeZone: 'Europe/London',
  authorizeTool: authorizeSingleOwner,
})

try {
  await familiar.send({
    author: { id: 'person-123', name: 'Sam' },
    text: 'Hello',
    requestId: crypto.randomUUID(),
  })
  await familiar.idle()

  // The committed conversation, as a chat UI would show it.
  const watch = await familiar.watch()
  for (const item of toTranscript(watch.value).items) {
    if (item.type === 'message' && typeof item.author !== 'string') {
      console.log(`${item.author.name}: ${item.text}`)
    } else if (item.type === 'reply') {
      console.log(`Familiar: ${item.text}`)
    }
  }
  await watch.stop()
} finally {
  await familiar.dismiss()
}
