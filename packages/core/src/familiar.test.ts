import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import type { TranscriptContext } from '@earendil-works/pi-ai'
import { estimateMessageTokens } from '@earendil-works/pi-ai/utils/estimate'
import { MemoryStorage } from '@earendil-works/pi-durable'
import { afterEach, expect, test } from 'vitest'
import {
  compactionFor,
  openFamiliar,
  type Familiar,
  type FamiliarOptions,
} from './familiar.ts'

type SetupOptions = Partial<Omit<FamiliarOptions, 'models' | 'model'>> & {
  contextWindow?: number
}

// A scripted model: each test lists what it replies, so Familiar runs for real
// (storage, tools, prompt) with no network.
async function setup({ contextWindow, ...options }: SetupOptions = {}) {
  const faux = fauxProvider({ models: [{ id: 'faux-1', contextWindow }] })
  const models = createModels()
  models.setProvider(faux.provider)
  const familiar = await openFamiliar({
    storage: new MemoryStorage(),
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    ...options,
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

/** Pi's own estimate of a request's size, the one its thresholds use. */
const tokensOf = (context: TranscriptContext) =>
  context.messages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  )

const isSummaryRequest = (context: TranscriptContext) =>
  JSON.stringify(context.messages[0]).includes('context summarization')

test('compaction keeps requests under the context budget', async () => {
  const budget = 2_000
  const { faux, familiar, say } = await setup({
    contextWindow: 16_000,
    contextBudget: budget,
  })
  const requests: number[] = []
  faux.setResponses(
    Array.from({ length: 60 }, () => (context: TranscriptContext) => {
      if (isSummaryRequest(context))
        return fauxAssistantMessage('## Goal\nChatting about the weather.')
      requests.push(tokensOf(context))
      return fauxAssistantMessage('Lovely. '.repeat(20))
    }),
  )

  for (let day = 1; day <= 20; day++)
    await say(`Day ${day}: the weather was ${'mild and grey, '.repeat(20)}`)

  const watch = await familiar.watch()
  await watch.stop()
  expect(
    watch.value.entries.some((entry) => entry.kind === 'pi.compaction'),
  ).toBe(true)
  expect(requests.length).toBe(20)
  // Unbounded, the last request would hold all twenty days, about 2,800 tokens.
  expect(Math.max(...requests)).toBeLessThan(budget)
})

test('the default budget compacts gpt-6.1-sol well before its window', () => {
  const settings = compactionFor(272_000, 64_000)
  expect(settings).toEqual({
    reserveTokens: 208_000,
    keepRecentTokens: 21_333,
    backgroundTokens: 16_000,
  })
})
