import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import type { TranscriptContext } from '@earendil-works/pi-ai'
import { estimateMessageTokens } from '@earendil-works/pi-ai/utils/estimate'
import { MemoryStorage, type EntryRecord } from '@earendil-works/pi-durable'
import { afterEach, expect, test } from 'vitest'
import {
  compactionFor,
  MESSAGE_KIND,
  openFamiliar,
  type MessageData,
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

test('history returns the messages compaction took out of the view', async () => {
  const { faux, familiar, say } = await setup({
    contextWindow: 16_000,
    contextBudget: 2_000,
  })
  faux.setResponses(
    Array.from(
      { length: 60 },
      () => (context: TranscriptContext) =>
        fauxAssistantMessage(
          isSummaryRequest(context) ? '## Goal\nThe weather.' : 'Lovely.',
        ),
    ),
  )
  for (let day = 1; day <= 20; day++)
    await say(`Day ${day}: the weather was ${'mild and grey, '.repeat(20)}`)

  const watch = await familiar.watch()
  await watch.stop()
  const [first] = watch.value.entries
  expect(first.kind).toBe('pi.compaction')
  const days = (entries: readonly EntryRecord[]) =>
    entries.flatMap((entry) =>
      entry.kind === MESSAGE_KIND
        ? [Number(/Day (\d+)/.exec((entry.data as MessageData).text)![1])]
        : [],
    )
  const inView = days(watch.value.entries)
  expect(inView[0]).toBeGreaterThan(1)

  // Page back from the view's oldest entry, a few at a time.
  const older: EntryRecord[] = []
  let before = first.head!
  for (;;) {
    const page = await familiar.history(before, 5)
    expect(page.entries.length).toBeLessThanOrEqual(5)
    older.unshift(...page.entries.toReversed())
    if (!page.more) break
    before = page.entries.at(-1)!.id
  }
  expect([...days(older), ...inView]).toEqual(
    Array.from({ length: 20 }, (_, i) => i + 1),
  )
  expect(older.every((entry) => entry.id < first.head!)).toBe(true)
})

test('the default budget compacts gpt-6.1-sol well before its window', () => {
  const settings = compactionFor(272_000, 64_000)
  expect(settings).toEqual({
    reserveTokens: 208_000,
    keepRecentTokens: 21_333,
    backgroundTokens: 16_000,
  })
})

test('current_time reads the Harness clock', async () => {
  const at = new Date('2026-03-04T12:34:00Z').getTime()
  const { faux, say } = await setup({ now: () => at })
  let toolResult = ''
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('current_time', { timeZone: 'UTC' }), {
      stopReason: 'toolUse',
    }),
    (context) => {
      toolResult = JSON.stringify(context.messages.at(-1))
      return fauxAssistantMessage('It is Wednesday afternoon.')
    },
  ])
  await say('What time is it?')
  expect(toolResult).toContain('Wednesday, 4 March 2026')
  expect(toolResult).toContain('12:34')
})
