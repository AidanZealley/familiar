import { expect, test } from 'vitest'
import { runRecallEval } from './recall.ts'
import type { Scenario } from './scenario.ts'

const scenario: Scenario = {
  id: 'tiny',
  days: [
    { date: '2025-01-06', text: 'Tidal Rooms uses a 12 V Eden pump.' },
    { date: '2025-01-07' },
    { date: '2025-01-08', text: 'I thought a little about lunch.' },
  ],
  questions: [
    {
      id: 'pump',
      category: 'old-facts',
      text: 'Which pump does Tidal Rooms use?',
      // Filler such as "I … thought a little about Tidal Rooms" matches, but
      // only scenario exchanges count, and the one that says it doesn't.
      required: [
        'Eden',
        'Tidal Rooms',
        'thought a little',
        'a string nobody said',
      ],
      optional: [],
    },
  ],
}

test('scores only scenario exchanges and skips strings never said', () => {
  const result = runRecallEval(scenario)
  expect(result.skipped).toEqual([
    { question: 'pump', required: 'a string nobody said' },
  ])
  for (const score of result.scores.filter(
    ({ category }) => category === 'old-facts',
  )) {
    expect(score).toMatchObject({ required: 3, at5: 2, at10: 2 })
  }
  expect(result.exchanges[10]).toBe(2 + 10 * 365 * 10)
})
