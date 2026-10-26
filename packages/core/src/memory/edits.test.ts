import { expect, test } from 'vitest'
import { forgetFact, reviseFact } from './edits.ts'
import { HARD_LIMIT, type MemoryState } from './memory.ts'

const initial = (): MemoryState => ({
  facts: [
    { id: 'm1', text: 'Lives in Leeds', at: 10 },
    { id: 'm2', text: 'Has a cat', at: 20 },
  ],
  next: 3,
})

test('revising changes only the chosen fact and leaves the input untouched', () => {
  const memory = initial()
  const revised = reviseFact(memory, 'm1', 'Lives in York', 30)
  expect(revised).toEqual({
    facts: [
      { id: 'm1', text: 'Lives in York', at: 30 },
      { id: 'm2', text: 'Has a cat', at: 20 },
    ],
    next: 3,
  })
  expect(memory).toEqual(initial())
})

test('forgetting removes only the chosen fact without reusing its number', () => {
  const memory = initial()
  expect(forgetFact(memory, 'm1')).toEqual({
    facts: [memory.facts[1]],
    next: 3,
  })
  expect(memory).toEqual(initial())
})

test('missing facts return the original value for callers to handle', () => {
  const memory = initial()
  expect(reviseFact(memory, 'm9', 'Unknown', 30)).toBe(memory)
  expect(forgetFact(memory, 'm9')).toBe(memory)
  expect(memory).toEqual(initial())
})

test('revising accepts text past the remember limit', () => {
  const memory = initial()
  const text = 'x'.repeat(HARD_LIMIT + 1)
  expect(reviseFact(memory, 'm1', text, 30).facts[0]).toEqual({
    id: 'm1',
    text,
    at: 30,
  })
})

test('forgetting the final fact leaves an empty list and preserves the next id', () => {
  const memory = { facts: [{ id: 'm7', text: 'Old', at: 10 }], next: 8 }
  expect(forgetFact(memory, 'm7')).toEqual({ facts: [], next: 8 })
  expect(memory.facts).toHaveLength(1)
})
