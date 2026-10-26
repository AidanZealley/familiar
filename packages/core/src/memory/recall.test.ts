import { expect, test } from 'vitest'
import {
  rememberFact,
  retireFact,
  reviseFact,
  type MemoryState,
} from './facts.ts'
import { describeFact, RECALL_LIMIT, searchFacts } from './recall.ts'

const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 0, 1)

const memoryOf = (...facts: [text: string, importance: number][]) => {
  const memory: MemoryState = { facts: [], next: 1 }
  for (const [text, importance] of facts)
    rememberFact(memory, text, importance, now - 30 * DAY)
  return memory
}

const ids = (memory: MemoryState, query: string) =>
  searchFacts(memory, query, now).map((fact) => fact.id)

test('finds matching facts outside core and leaves out core', () => {
  const memory = memoryOf(
    ["Pip's waterproof coat is 66 cm, from Fell Houndwear", 2],
    ['Pip is a retired greyhound', 5],
    ['The kitchen tap drips', 1],
  )
  expect(ids(memory, 'What size coat does Pip wear?')).toEqual(['m1'])
})

test('a message with no meaningful overlap recalls nothing', () => {
  const memory = memoryOf(
    ["Pip's waterproof coat is 66 cm", 2],
    ['Likes blue pens', 1],
  )
  expect(ids(memory, 'How are you doing today?')).toEqual([])
})

test('importance and recency rank equally relevant facts', () => {
  const memory = memoryOf(['Minor note about the shed', 1])
  rememberFact(memory, 'Important note about the shed', 2, now - 30 * DAY)
  expect(ids(memory, 'shed note')).toEqual(['m2', 'm1'])

  const aged = memoryOf(['Shed key is under the pot', 2])
  rememberFact(aged, 'Shed key is on the hook', 2, now - 3 * 365 * DAY)
  expect(ids(aged, 'shed key')).toEqual(['m1', 'm2'])
})

test('past facts are found, ranked below current ones and labelled', () => {
  const memory = memoryOf(['Lives at 18 Beech Terrace in Leeds', 2])
  reviseFact(memory, 'm1', 'Lives at 9 Foss Lane in York', now - 10 * DAY)
  memory.facts[1].core = false
  expect(ids(memory, 'Where do I live?')).toEqual(['m2', 'm1'])
  expect(describeFact(memory, memory.facts[0])).toBe(
    'm1 (2025-12-02 to 2025-12-22, no longer current; replaced by m2): Lives at 18 Beech Terrace in Leeds',
  )
  expect(describeFact(memory, memory.facts[1])).toBe(
    'm2 (since 2025-12-22): Lives at 9 Foss Lane in York',
  )
  retireFact(memory, 'm2', now)
  expect(describeFact(memory, memory.facts[1])).toContain(
    'to 2026-01-01, no longer current): ',
  )
})

test('stays within the limit and the token budget', () => {
  const many = memoryOf(
    ...Array.from(
      { length: 20 },
      (_, index) => [`Garden note ${index}`, 1] as [string, number],
    ),
  )
  expect(ids(many, 'garden')).toHaveLength(RECALL_LIMIT)

  const long = memoryOf(
    [`Garden plan: ${'raised beds and paths '.repeat(300)}`, 2],
    ['Garden gate is 84 cm', 2],
  )
  expect(ids(long, 'garden')).toEqual(['m2'])
})

test('the index follows changes to memory', () => {
  const memory = memoryOf(['Drinks coffee', 2])
  expect(ids(memory, 'tea')).toEqual([])
  const next = structuredClone(memory)
  rememberFact(next, 'Drinks peppermint tea', 2, now)
  expect(ids(next, 'tea')).toEqual(['m2'])
})
