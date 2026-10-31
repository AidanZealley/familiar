import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
} from '@earendil-works/pi-ai/providers/faux'
import { MemoryStorage } from '@earendil-works/pi-durable'
import { defaultPersona, summonFamiliar } from '@familiar/core'
import { expect, test } from 'vitest'
import { webPersona } from './persona.ts'

test('the web host keeps the default persona and names what its chat draws', async () => {
  const faux = fauxProvider({ models: [{ id: 'faux-1' }] })
  const models = createModels()
  models.setProvider(faux.provider)
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    timeZone: 'Europe/London',
    name: 'Wren',
    persona: webPersona('Wren'),
  })
  let preamble: string | null | undefined
  faux.setResponses([
    (context) => {
      const system = context.messages.find(
        (message) => message.role === 'system',
      )
      preamble =
        system?.role === 'system' ? system.sections?.preamble : undefined
      return fauxAssistantMessage('Hello.')
    },
  ])
  try {
    await familiar.send({ author: 'owner', text: 'Hello', requestId: 'hello' })
    await familiar.idle()
  } finally {
    await familiar.dismiss()
  }

  expect(preamble).toContain(defaultPersona('Wren'))
  expect(preamble).toContain('KaTeX between $$ delimiters')
  expect(preamble).toContain('Mermaid diagrams in ```mermaid fences')
  expect(preamble).toContain('images by URL')
})
