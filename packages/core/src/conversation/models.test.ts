import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux'
import {
  createRegistry,
  type HarnessSettings,
} from '@earendil-works/pi-durable'
import { expect, test } from 'vitest'
import { harnessOptions } from '../workspace/harness.ts'
import { fauxModels, testHost } from '../testing.ts'
import { ModelError, type ModelChoice } from './models.ts'

const sol = { provider: 'faux', modelId: 'sol' }
const luna = { provider: 'faux', modelId: 'luna' }
const both: ModelChoice[] = [
  { model: sol, thinkingLevel: 'low' },
  { model: luna, thinkingLevel: 'medium' },
]

const solAndLuna = [
  { id: 'sol', reasoning: true, contextWindow: 16_000 },
  { id: 'luna', reasoning: true, contextWindow: 64_000 },
]

// Each reply records the model and level its request was sent with.
async function open(modelChoices = both) {
  const host = await testHost({
    faux: solAndLuna,
    chatModel: sol,
    modelChoices,
  })
  const requests: [string, ModelThinkingLevel | undefined][] = []
  host.faux.setResponses(
    Array.from({ length: 20 }, () => (_context, options, _state, model) => {
      requests.push([model.id, options?.reasoning])
      return fauxAssistantMessage('Hello.')
    }),
  )
  return {
    familiar: host.familiar,
    reopen: host.reopen,
    /** Sends `text` and returns the model and level that answered it. */
    say: async (text: string) => {
      await host.say(text)
      return requests.at(-1)
    },
  }
}

test('each model keeps the level last picked for it', async () => {
  const f = await open()
  const familiar = f.familiar()
  const say = f.say
  await familiar.setModel(luna)
  await familiar.setThinkingLevel('high')
  // Sol was never changed, so it starts on its own default.
  await familiar.setModel(sol)
  expect(await say('one')).toEqual(['sol', 'low'])

  await familiar.setModel(luna)
  expect(await say('two')).toEqual(['luna', 'high'])
})

test('the model and level survive a restart', async () => {
  const f = await open()
  await f.familiar().setModel(luna)
  await f.familiar().setThinkingLevel('high')
  await f.reopen()
  expect(await f.say('hello')).toEqual(['luna', 'high'])
})

test('a model no longer offered falls back to the default', async () => {
  const f = await open()
  await f.familiar().setModel(luna)
  await f.reopen({ modelChoices: [both[0]] })
  expect(await f.say('hello')).toEqual(['sol', 'low'])
})

test('models and levels outside the model choices are refused', async () => {
  const familiar = (await open()).familiar()
  await expect(
    familiar.setModel({ provider: 'faux', modelId: 'other' }),
  ).rejects.toThrow(ModelError)
  await expect(familiar.setThinkingLevel('max')).rejects.toThrow(ModelError)
})

test('every chat model compacts at the same budget', () => {
  const { models } = fauxModels(solAndLuna)
  // Familiar passes settings as an object, not Pi's function form.
  const settings = harnessOptions(
    { models, chatModel: sol, modelChoices: both },
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
