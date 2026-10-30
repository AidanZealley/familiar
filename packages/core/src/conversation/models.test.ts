import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
} from '@earendil-works/pi-ai/providers/faux'
import {
  createRegistry,
  type HarnessSettings,
  type Storage,
} from '@earendil-works/pi-durable'
import { afterEach, expect, test } from 'vitest'
import { harnessOptions } from '../context/index.ts'
import { summonFamiliar, type Familiar } from '../familiar.ts'
import { ReopenableStorage } from '../memory/testing.ts'
import { ModelError, type ChatModel } from './models.ts'

const sol = { provider: 'faux', modelId: 'sol' }
const luna = { provider: 'faux', modelId: 'luna' }
const both: ChatModel[] = [
  { model: sol, thinkingLevel: 'low' },
  { model: luna, thinkingLevel: 'medium' },
]

const opened: Familiar[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((familiar) => familiar.dismiss()))
})

const fauxModels = () => {
  const faux = fauxProvider({
    models: [
      { id: 'sol', reasoning: true, contextWindow: 16_000 },
      { id: 'luna', reasoning: true, contextWindow: 64_000 },
    ],
  })
  const models = createModels()
  models.setProvider(faux.provider)
  return { faux, models }
}

// Each reply records the model and level its request was sent with.
async function open(storage: Storage, chatModels = both) {
  const { faux, models } = fauxModels()
  const familiar = await summonFamiliar({
    storage,
    models,
    model: sol,
    chatModels,
  })
  opened.push(familiar)

  const requests: [string, ModelThinkingLevel | undefined][] = []
  faux.setResponses(
    Array.from({ length: 20 }, () => (_context, options, _state, model) => {
      requests.push([model.id, options?.reasoning])
      return fauxAssistantMessage('Hello.')
    }),
  )

  /** Sends `text` and returns the model and level that answered it. */
  const say = async (text: string) => {
    await familiar.send({ author: 'aidan', text, requestId: text })
    await familiar.idle()
    return requests.at(-1)
  }
  return { familiar, say }
}

test('each model keeps the level last picked for it', async () => {
  const { familiar, say } = await open(new ReopenableStorage())
  expect(await say('one')).toEqual(['sol', 'low'])

  await familiar.setModel(luna)
  expect(await say('two')).toEqual(['luna', 'medium'])

  await familiar.setThinkingLevel('high')
  expect(await say('three')).toEqual(['luna', 'high'])

  await familiar.setModel(sol)
  expect(await say('four')).toEqual(['sol', 'low'])

  await familiar.setModel(luna)
  expect(await say('five')).toEqual(['luna', 'high'])
})

test('the model and level survive a restart', async () => {
  const storage = new ReopenableStorage()
  const first = await open(storage)
  await first.familiar.setModel(luna)
  await first.familiar.setThinkingLevel('high')
  await opened.pop()!.dismiss()

  const second = await open(storage)
  expect(await second.say('hello')).toEqual(['luna', 'high'])
})

test('a model no longer offered falls back to the default', async () => {
  const storage = new ReopenableStorage()
  const first = await open(storage)
  await first.familiar.setModel(luna)
  await opened.pop()!.dismiss()

  const second = await open(storage, [both[0]])
  expect(await second.say('hello')).toEqual(['sol', 'low'])
})

test('models and levels outside the chat models are refused', async () => {
  const { familiar } = await open(new ReopenableStorage())
  await expect(
    familiar.setModel({ provider: 'faux', modelId: 'other' }),
  ).rejects.toThrow(ModelError)
  await expect(familiar.setThinkingLevel('max')).rejects.toThrow(ModelError)
})

test('every chat model compacts at the same budget', () => {
  const { models } = fauxModels()
  // Familiar passes settings as an object, not Pi's function form.
  const settings = harnessOptions(
    { models, model: sol, chatModels: both },
    createRegistry(),
    2_000,
  ).settings as HarnessSettings
  // Pi measures from the top of each window, so the reserves differ.
  expect(settings.compaction?.reserveTokens).toBe(14_000)
  expect(settings.compaction?.modelOverrides).toMatchObject({
    'faux/sol': { reserveTokens: 14_000 },
    'faux/luna': { reserveTokens: 62_000 },
  })
})
