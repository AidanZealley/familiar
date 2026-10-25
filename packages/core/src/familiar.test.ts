import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import type { TranscriptContext } from '@earendil-works/pi-ai'
import { MemoryStorage } from '@earendil-works/pi-durable'
import { afterEach, expect, test } from 'vitest'
import { openFamiliar, type Familiar } from './familiar.ts'

// A scripted model: each test lists what it replies, so Familiar runs for real
// (storage, tools, prompt) with no network.
async function setup() {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const familiar = await openFamiliar({
    storage: new MemoryStorage(),
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
  })
  opened.push(familiar)

  const say = async (text: string) => {
    await familiar.send({ author: 'aidan', text, requestId: text })
    await familiar.idle()
  }
  const memory = async () => {
    const watch = await familiar.memory.watch()
    await watch.stop()
    return watch.value
  }
  return { faux, familiar, say, memory }
}

const opened: Familiar[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((familiar) => familiar.close()))
})

/** The system prompt sections of one request. */
const sectionsOf = (context: TranscriptContext) =>
  context.messages.flatMap((message) =>
    message.role === 'system' ? [message.sections ?? {}] : [],
  )

test('the model remembers a fact and sees it on the next request', async () => {
  const { faux, say, memory } = await setup()
  let prompt: Record<string, string | null>[] = []
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('remember', { text: 'Uses pnpm' }), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage('Noted.'),
    (context) => {
      prompt = sectionsOf(context)
      return fauxAssistantMessage('pnpm, as always.')
    },
  ])

  await say('I always use pnpm.')
  expect((await memory())?.facts).toMatchObject([
    { id: 'm1', text: 'Uses pnpm' },
  ])

  await say('Which package manager?')
  const latest = prompt.findLast((sections) => sections.memory)
  expect(latest?.memory).toContain('m1: Uses pnpm')
})

test('people can revise and forget facts', async () => {
  const { faux, familiar, say, memory } = await setup()
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall('remember', { text: 'Lives in Leeds' }),
        fauxToolCall('remember', { text: 'Has a cat' }),
      ],
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Noted.'),
  ])
  await say('I live in Leeds and have a cat.')

  await familiar.memory.revise('m1', 'Lives in York')
  await familiar.memory.forget('m2')
  expect((await memory())?.facts).toMatchObject([
    { id: 'm1', text: 'Lives in York' },
  ])
})

test('a fact that does not exist is an error for the model, not a crash', async () => {
  const { faux, say, memory } = await setup()
  let result = ''
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('forget', { id: 'm9' }), {
      stopReason: 'toolUse',
    }),
    (context) => {
      const last = context.messages.at(-1)
      if (last?.role === 'toolResult')
        result = last.content
          .map((part) => ('text' in part ? part.text : ''))
          .join('')
      return fauxAssistantMessage('Nothing to forget.')
    },
  ])
  await say('Forget m9.')
  expect(result).toContain('No fact m9')
  expect((await memory())?.facts).toEqual([])
})

test('search_history finds what was said earlier', async () => {
  const { faux, say } = await setup()
  let result = ''
  faux.setResponses([
    fauxAssistantMessage('Sounds lovely.'),
    fauxAssistantMessage(fauxToolCall('search_history', { query: 'lisbon' }), {
      stopReason: 'toolUse',
    }),
    (context) => {
      const last = context.messages.at(-1)
      if (last?.role === 'toolResult')
        result = last.content
          .map((part) => ('text' in part ? part.text : ''))
          .join('')
      return fauxAssistantMessage('You mentioned Lisbon.')
    },
  ])
  await say('We are going to Lisbon in May.')
  await say('Where did I say we were going?')
  expect(result).toContain('aidan: We are going to Lisbon in May.')
})
