import type { EntryId } from '@earendil-works/pi-durable'
import { expect, test } from 'vitest'
import { TEST_ZONE } from '../testing.ts'
import { parseDay } from '../time/index.ts'
import { datesIn } from './episodes.ts'
import { createExchangeIndex } from './exchanges.ts'

const DAY = 24 * 60 * 60 * 1000
const noonOf = (day: string) => parseDay(day).getTime() + DAY / 2
const now = noonOf('2026-01-01')

const indexOf = (...exchanges: [day: string, text: string][]) => {
  const index = createExchangeIndex(TEST_ZONE)
  exchanges.forEach(([day, text], number) =>
    index.add({
      id: `x${number + 1}`,
      at: noonOf(day),
      text,
      last: (number + 1) as EntryId,
    }),
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
  const index = createExchangeIndex(TEST_ZONE)
  for (let number = 1; number <= 20; number++) {
    index.add({
      id: `x${number}`,
      at: now - number * DAY,
      text: `Garden note ${number}`,
      last: number as EntryId,
    })
  }
  expect(ids(index, 'garden', 5)).toEqual(['x1', 'x2', 'x3', 'x4', 'x5'])
  index.add({
    id: 'x21',
    at: now,
    text: 'Garden gate is 84 cm',
    last: 21 as EntryId,
  })
  expect(index.size).toBe(21)
  expect(ids(index, 'garden gate', 1)).toEqual(['x21'])
})

test('opens an exchange with its neighbours, and those between two entries', () => {
  const index = indexOf(
    ['2025-03-01', 'First.'],
    ['2025-03-02', 'Second.'],
    ['2025-03-03', 'Third.'],
  )
  expect(index.around('x2')).toMatchObject({
    before: { id: 'x1' },
    exchange: { id: 'x2' },
    after: { id: 'x3' },
  })
  expect(index.around('x1')?.before).toBeUndefined()
  expect(index.around('x9')).toBeUndefined()
  expect(index.between(2 as EntryId, 3 as EntryId).map(({ id }) => id)).toEqual(
    ['x2', 'x3'],
  )
})

test('searches within a range of entries, counting exchanges a boundary splits', () => {
  const index = createExchangeIndex(TEST_ZONE)
  // Person messages at 10, 20 and 30, each answered a few entries later.
  for (const first of [10, 20, 30]) {
    index.add({
      id: `x${first}`,
      at: now,
      text: 'Garden gate notes.',
      last: (first + 3) as EntryId,
    })
  }
  const within = (after: number | null, before: number) =>
    index
      .search('garden gate', now, {
        within: { after: after as EntryId | null, before: before as EntryId },
      })
      .map(({ id }) => id)
      .sort()

  expect(within(null, 30)).toEqual(['x10', 'x20'])
  // Upkeep reviewed x10's question but not its reply.
  expect(within(11, 30)).toEqual(['x10', 'x20'])
  expect(within(13, 30)).toEqual(['x20'])
  // The view starts at x20's reply, so its question is out of view.
  expect(within(13, 22)).toEqual(['x20'])
  expect(within(13, 20)).toEqual([])
  // Upkeep has reviewed past the start of the view: nothing is unfiled.
  expect(within(25, 20)).toEqual([])
})

test('applies the range before the limit', () => {
  const index = createExchangeIndex(TEST_ZONE)
  for (let first = 1; first <= 10; first++) {
    index.add({
      id: `x${first * 10}`,
      // Newest first, so without the range these would fill the limit.
      at: now - (10 - first) * DAY,
      text: 'Garden gate notes.',
      last: (first * 10 + 1) as EntryId,
    })
  }
  expect(
    index
      .search('garden gate', now, {
        limit: 2,
        within: { after: null, before: 25 as EntryId },
      })
      .map(({ id }) => id),
  ).toEqual(['x20', 'x10'])
})
