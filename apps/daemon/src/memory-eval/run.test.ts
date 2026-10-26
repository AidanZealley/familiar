import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
} from '@earendil-works/pi-ai/providers/faux'
import { MemoryStorage } from '@earendil-works/pi-durable'
import { expect, test } from 'vitest'
import { judgePrompt } from './judge.ts'
import { runMemoryEval } from './run.ts'
import type { Scenario } from './scenario.ts'

test('replays days through upkeep, asks questions, and judges answers offline', async () => {
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
        expected: 'Bracken.',
      },
      {
        id: 'school',
        category: 'unknown',
        text: 'What is my primary school?',
        expected: 'Unknown.',
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
    return fauxAssistantMessage('{"pass":true,"reason":"Correct."}')
  }
  faux.setResponses([
    fauxAssistantMessage('Noted.'),
    upkeep,
    fauxAssistantMessage('Sounds good.'),
    upkeep,
    fauxAssistantMessage('Bracken.'),
    judge,
    fauxAssistantMessage('You have not told me.'),
    judge,
  ])

  const result = await runMemoryEval({
    storage: new MemoryStorage(),
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    scenario,
  })

  expect(faux.getPendingResponseCount()).toBe(0)
  expect(upkeepInputs).toHaveLength(2)
  expect(upkeepInputs[0]).toContain('My bicycle is called Bracken.')
  expect(upkeepInputs[1]).toContain('I fixed a loose spoke today.')
  expect(upkeepInputs[1]).not.toContain('My bicycle is called Bracken.')
  expect(judgeInputs[0]).toContain('Bracken.')
  expect(judgeInputs[1]).toContain('You have not told me.')
  expect(result.results.map(({ verdict }) => verdict.pass)).toEqual([
    true,
    true,
  ])
  expect(result.days).toBe(3)
})
