import { toRoomTranscript, type Transcript } from '@familiar-ai/client'
import { openWorkspace } from '@familiar-ai/core'
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

const workspace = await openWorkspace({
  storage: new MemoryStorage(),
  models,
  chatModel: { provider: 'faux', modelId: 'demo' },
  timeZone: 'Europe/London',
})

try {
  // One Familiar, and Sam's DM with it.
  const familiar = await workspace.familiars.create({ name: 'Familiar' })
  const dm = (await workspace.rooms.get(
    await workspace.rooms.dm(familiar.id, 'person-123'),
  ))!

  await dm.post({
    author: { id: 'person-123', name: 'Sam' },
    text: 'Hello',
    requestId: crypto.randomUUID(),
  })

  // The room's log, as a chat UI would show it, once the reply is in.
  const watch = await dm.watch()
  const transcript = await new Promise<Transcript>((resolve) => {
    const show = (view: typeof watch.value) => {
      const shown = toRoomTranscript(view)
      if (shown.items.some((item) => item.type === 'reply')) {
        resolve(shown)
      }
    }
    show(watch.value)
    watch.start(async (view) => show(view))
  })
  await watch.stop()
  for (const item of transcript.items) {
    if (item.type === 'message') {
      console.log(`${item.author.name}: ${item.text}`)
    } else if (item.type === 'reply') {
      console.log(`${item.name}: ${item.text}`)
    }
  }
} finally {
  await workspace.dismiss()
}
