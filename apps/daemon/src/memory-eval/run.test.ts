import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { judgePrompt, parseVerdict } from './judge.ts'
import { runMemoryEval, summarize, waitWithClock } from './run.ts'
import { categories, memoryScenario, type Scenario } from './scenario.ts'
import { createClock } from './clock.ts'

const temporary: string[] = []
afterEach(() =>
  temporary
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true })),
)

test('replays upkeep, isolates questions, and records judge failures offline', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'familiar-eval-test-'))
  temporary.push(directory)
  const replayPath = join(directory, 'replay.sqlite')
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const scenario: Scenario = {
    id: 'offline-test',
    days: [
      { date: '2026-01-05', text: 'My bicycle is called Bracken.' },
      { date: '2026-01-06', text: 'I fixed a loose spoke today.' },
      { date: '2026-01-07' },
    ],
    questions: [
      {
        id: 'bike',
        category: 'old-facts',
        text: 'What is my bicycle called?',
        required: ['Bracken'],
        optional: ['It is green'],
      },
      {
        id: 'school',
        category: 'unknown',
        text: 'Which bicycle shop did I choose for Bracken?',
        required: ['No bicycle shop was chosen', 'Bracken is my bicycle'],
        optional: [],
      },
    ],
  }
  const upkeepInputs: string[] = []
  const judgeInputs: string[] = []
  const upkeep = (context: { messages: unknown[] }) => {
    upkeepInputs.push(JSON.stringify(context.messages))
    return fauxAssistantMessage('No changes.')
  }
  const judge = (context: { messages: unknown[] }) => {
    expect((context.messages[0] as { content: string }).content).toContain(
      judgePrompt,
    )
    judgeInputs.push(JSON.stringify(context.messages))
    return fauxAssistantMessage(
      '{"pass":false,"reason":"Missing the bicycle name."}',
    )
  }
  faux.setResponses([
    fauxAssistantMessage('', {
      stopReason: 'error',
      errorMessage: '503 server busy',
    }),
    fauxAssistantMessage('Noted.'),
    fauxAssistantMessage('', {
      stopReason: 'error',
      errorMessage: '503 server busy',
    }),
    upkeep,
    fauxAssistantMessage('Sounds good.'),
    upkeep,
    fauxAssistantMessage(fauxToolCall('search_history', { query: 'bicycle' }), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage('I cannot recall its name.'),
    judge,
    (context) => {
      expect(JSON.stringify(context.messages)).not.toContain(
        'What is my bicycle called?',
      )
      return fauxAssistantMessage('No shop was chosen for Bracken.')
    },
    fauxAssistantMessage(
      '{"pass":true,"reason":"Rejects the premise and names Bracken."}',
    ),
  ])
  const result = await runMemoryEval({
    storage: await openNodeSqliteStorage(replayPath),
    createQuestionStorage: async (id) => {
      const path = join(directory, `${id}.sqlite`)
      expect(existsSync(`${replayPath}-wal`)).toBe(false)
      copyFileSync(replayPath, path)
      const storage = await openNodeSqliteStorage(path)
      for (const status of [
        'pending',
        'running',
        'waiting',
        'completing',
      ] as const) {
        expect(
          (
            await storage.scanTasks(
              { status },
              1,
              undefined,
              BACKGROUND_CONTEXT,
            )
          ).items,
        ).toEqual([])
      }
      const sleeping = await storage.scanTasks(
        { status: 'sleeping' },
        2,
        undefined,
        BACKGROUND_CONTEXT,
      )
      expect(sleeping.items).toHaveLength(1)
      expect(sleeping.items[0].kind).toBe('familiar.upkeep')
      return storage
    },
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    scenario,
    questionConcurrency: 1,
  })
  expect(faux.getPendingResponseCount()).toBe(0)
  expect(upkeepInputs).toHaveLength(2)
  expect(upkeepInputs[0]).toContain('My bicycle is called Bracken.')
  expect(upkeepInputs[1]).toContain('I fixed a loose spoke today.')
  expect(upkeepInputs[1]).not.toContain('My bicycle is called Bracken.')
  const judged = JSON.parse(JSON.parse(judgeInputs[0])[1].content)
  expect(judged.required).toEqual(['Bracken'])
  expect(judged.optional).toEqual(['It is green'])
  expect(judgeInputs[0]).toContain('I cannot recall its name.')
  expect(result.results.map(({ verdict }) => verdict.pass)).toEqual([
    false,
    true,
  ])
  expect(result.results[0].toolCalls).toContainEqual(
    expect.objectContaining({
      name: 'search_history',
      arguments: { query: 'bicycle' },
      result: expect.objectContaining({ role: 'toolResult' }),
    }),
  )
  expect(result.upkeep.map(({ outcome }) => outcome)).toEqual([
    'advanced',
    'advanced',
    'no-messages',
  ])
  expect(result.memory.document).toBeTruthy()
  expect(result.compactions).toBe(0)
  expect(result.days).toBe(3)
  expect(summarize(result.results)).toContainEqual({
    category: 'old-facts',
    passed: 0,
    total: 1,
  })
  expect(summarize(result.results)).toContainEqual({
    category: 'unknown',
    passed: 1,
    total: 1,
  })
})

test('parseVerdict accepts fenced JSON and rejects malformed replies', () => {
  expect(
    parseVerdict('```json\n{"pass":true,"reason":"Correct."}\n```'),
  ).toEqual({ pass: true, reason: 'Correct.' })
  expect(() => parseVerdict('```json\n{"pass":"yes"}\n```')).toThrow(
    'Judge must return',
  )
  expect(() => parseVerdict('The answer passes.')).toThrow()
})

test('clock waits drive retries but never cross the next scripted event', async () => {
  const clock = createClock(0)
  let fired = false
  clock.setTimer(
    () => {
      fired = true
    },
    100,
    { background: false },
  )
  await waitWithClock(clock, 200, 'Retry', async () => fired)
  expect(clock.now()).toBe(100)
  clock.setTimer(
    () => {
      throw new Error('Crossed the boundary')
    },
    100,
    { background: false },
  )
  await expect(
    waitWithClock(clock, 200, 'Blocked reply', async () => false, 60),
  ).rejects.toThrow(
    'Blocked reply timed out after 0.06s of inactivity at simulated',
  )
  expect(clock.now()).toBe(100)
})

test('scenario has five questions per category and distinct crowding facts', () => {
  for (const category of categories)
    expect(
      memoryScenario.questions.filter(
        (question) => question.category === category,
      ),
    ).toHaveLength(5)
  const preferences = memoryScenario.days.flatMap(
    (day) =>
      day.text
        ?.split('\n')
        .filter((line) => line.includes(', my standing choice is ')) ?? [],
  )
  expect(new Set(preferences).size).toBe(108)
  expect(preferences.join('\n').length).toBeGreaterThan(6_000)
  expect(
    memoryScenario.days
      .slice(71)
      .map((day) => day.text ?? '')
      .join(' '),
  ).not.toMatch(/York|peppermint|hide|library/i)
})

test('full scenario compacts tested sessions out of verbatim context offline', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'familiar-eval-full-'))
  temporary.push(directory)
  const replayPath = join(directory, 'replay.sqlite')
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  faux.setResponses(
    Array.from({ length: 300 }, () => (context) => {
      if (
        JSON.stringify(context.messages[0]).includes(
          'You grade a personal assistant',
        )
      )
        return fauxAssistantMessage(
          '{"pass":false,"reason":"Scripted answer lacks required facts."}',
        )
      if (JSON.stringify(context.messages[0]).includes('context summarization'))
        return fauxAssistantMessage(
          '## Goal\nDiscussing hobbies and daily life.',
        )
      return fauxAssistantMessage('Noted.')
    }),
  )
  const result = await runMemoryEval({
    storage: await openNodeSqliteStorage(replayPath),
    createQuestionStorage: async (id) => {
      const path = join(directory, `${id}.sqlite`)
      expect(existsSync(`${replayPath}-wal`)).toBe(false)
      copyFileSync(replayPath, path)
      const storage = await openNodeSqliteStorage(path)
      for (const status of [
        'pending',
        'running',
        'waiting',
        'completing',
      ] as const) {
        expect(
          (
            await storage.scanTasks(
              { status },
              1,
              undefined,
              BACKGROUND_CONTEXT,
            )
          ).items,
        ).toEqual([])
      }
      const sleeping = await storage.scanTasks(
        { status: 'sleeping' },
        2,
        undefined,
        BACKGROUND_CONTEXT,
      )
      expect(sleeping.items).toHaveLength(1)
      expect(sleeping.items[0].kind).toBe('familiar.upkeep')
      return storage
    },
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    scenario: memoryScenario,
  })
  expect(result.compactions).toBeGreaterThan(0)
  expect(result.results).toHaveLength(25)
  expect(result.results.every(({ verdict }) => !verdict.pass)).toBe(true)
  expect(
    result.upkeep.filter(({ outcome }) => outcome === 'advanced'),
  ).toHaveLength(18)
  expect(result.judgeIsTestModel).toBe(true)
})

test('fails loudly if an upkeep pass does not advance through the messages', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'familiar-eval-failed-upkeep-'))
  temporary.push(directory)
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  faux.setResponses([
    fauxAssistantMessage('Noted.'),
    fauxAssistantMessage('', {
      stopReason: 'error',
      errorMessage: '400 invalid request',
    }),
  ])
  await expect(
    runMemoryEval({
      storage: await openNodeSqliteStorage(join(directory, 'replay.sqlite')),
      createQuestionStorage: async () => {
        throw new Error('Must fail before questions')
      },
      models,
      model: { provider: 'faux', modelId: 'faux-1' },
      scenario: {
        id: 'failed-upkeep',
        days: [{ date: '2026-01-05', text: 'My bicycle is Bracken.' }],
        questions: [],
      },
    }),
  ).rejects.toThrow('Memory upkeep on 2026-01-05 did not advance through')
})

test('clock waits reset the inactivity deadline while progress continues', async () => {
  // Progress events every 30ms keep a 60ms deadline alive well past 60ms.
  let checks = 0
  const started = Date.now()
  const everyThirtyMs = (listener: () => void) => {
    const interval = setInterval(listener, 30)
    return () => clearInterval(interval)
  }
  await waitWithClock(
    createClock(0),
    1,
    'Slow active reply',
    async () => ++checks >= 8,
    60,
    everyThirtyMs,
  )
  expect(Date.now() - started).toBeGreaterThan(150)
  await expect(
    waitWithClock(
      createClock(0),
      1,
      'Stalled upkeep',
      async () => false,
      60,
      () => () => {},
    ),
  ).rejects.toThrow('Stalled upkeep timed out after 0.06s of inactivity')
})

test.each([
  { name: 'tested user session', cutoff: '2026-01-05', reply: 'Noted.' },
  {
    name: 'assistant repeating a tested phrase',
    cutoff: '2026-01-04',
    reply: 'Your bicycle is Bracken.',
  },
])('rejects verbatim context containing $name', async ({ cutoff, reply }) => {
  const directory = mkdtempSync(join(tmpdir(), 'familiar-eval-context-'))
  temporary.push(directory)
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  faux.setResponses([
    fauxAssistantMessage(reply),
    fauxAssistantMessage('No changes.'),
  ])
  await expect(
    runMemoryEval({
      storage: await openNodeSqliteStorage(join(directory, 'replay.sqlite')),
      createQuestionStorage: async () => {
        throw new Error('Must fail before copying')
      },
      models,
      model: { provider: 'faux', modelId: 'faux-1' },
      scenario: {
        id: 'context-guard',
        testedFactsThrough: cutoff,
        testedPhrases: ['bracken'],
        days: [{ date: '2026-01-05', text: 'My bicycle is Bracken.' }],
        questions: [],
      },
    }),
  ).rejects.toThrow('Tested sessions remain in verbatim context')
})

test('closes question storage when opening Familiar fails', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'familiar-eval-open-failure-'))
  temporary.push(directory)
  const replayPath = join(directory, 'replay.sqlite')
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  let close: ReturnType<typeof vi.spyOn> | undefined
  await expect(
    runMemoryEval({
      storage: await openNodeSqliteStorage(replayPath),
      createQuestionStorage: async () => {
        const path = join(directory, 'question.sqlite')
        copyFileSync(replayPath, path)
        const storage = await openNodeSqliteStorage(path)
        close = vi.spyOn(storage, 'close')
        vi.spyOn(models, 'getModel').mockImplementationOnce(() => {
          throw new Error('Cannot open question')
        })
        return storage
      },
      models,
      model: { provider: 'faux', modelId: 'faux-1' },
      scenario: {
        id: 'open-failure',
        days: [{ date: '2026-01-05' }],
        questions: [memoryScenario.questions[0]],
      },
    }),
  ).rejects.toThrow('Cannot open question')
  expect(close).toHaveBeenCalledOnce()
})
