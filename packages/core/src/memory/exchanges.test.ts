import { expect, test } from 'vitest'
import { parseDay } from '../time/index.ts'
import { datesIn } from './episodes.ts'
import { createExchangeIndex } from './exchanges.ts'

const DAY = 24 * 60 * 60 * 1000
const noonOf = (day: string) => parseDay(day).getTime() + DAY / 2
const now = noonOf('2026-01-01')

const indexOf = (...exchanges: [day: string, text: string][]) => {
  const index = createExchangeIndex()
  exchanges.forEach(([day, text], number) =>
    index.add({ id: `x${number + 1}`, at: noonOf(day), text }),
  )
  return index
}

const ids = (
  index: ReturnType<typeof createExchangeIndex>,
  query: string,
  limit?: number,
) =>
  index
    .search(query, now, { limit, ranges: datesIn(query, '2026-01-01') })
    .map(({ id }) => id)

test('finds exchanges by their words, with recall term processing', () => {
  const index = indexOf(
    ['2025-03-01', "Pip's waterproof coat is 66 cm, from Fell Houndwear."],
    ['2025-03-02', 'The kitchen tap drips again.'],
  )
  expect(index.size).toBe(2)
  expect(ids(index, 'What size coat does Pip wear?')).toEqual(['x1'])
  // Stop words and fragments match nothing.
  expect(ids(index, "What's it about?")).toEqual([])
})

test('ranks equally relevant exchanges by recency', () => {
  const index = indexOf(
    ['2022-06-01', 'The shed key is under the pot.'],
    ['2025-12-01', 'The shed key is on the hook.'],
  )
  expect(ids(index, 'shed key')).toEqual(['x2', 'x1'])
})

test('finds exchanges on the days a query names, even without its words', () => {
  const index = indexOf(
    ['2025-03-04', 'Fired the porcelain tiles in the community kiln.'],
    ['2025-03-05', 'Glazed a few test pieces.'],
    ['2025-11-20', 'What a day, I am tired.'],
  )
  expect(ids(index, 'What did I do on 4 March 2025?')[0]).toBe('x1')
  // A month boosts every day in it, and nothing outside.
  expect(ids(index, 'What happened in March 2025?').sort()).toEqual([
    'x1',
    'x2',
  ])
})

test('stays within the limit, adding as it goes', () => {
  const index = createExchangeIndex()
  for (let number = 1; number <= 20; number++) {
    index.add({
      id: `x${number}`,
      at: now - number * DAY,
      text: `Garden note ${number}`,
    })
  }
  expect(ids(index, 'garden', 5)).toEqual(['x1', 'x2', 'x3', 'x4', 'x5'])
  index.add({ id: 'x21', at: now, text: 'Garden gate is 84 cm' })
  expect(index.size).toBe(21)
  expect(ids(index, 'garden gate', 1)).toEqual(['x21'])
})
