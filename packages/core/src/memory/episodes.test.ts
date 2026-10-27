import { expect, test } from 'vitest'
import { localDay } from '../time/index.ts'
import { upkeepDay } from './upkeep.ts'
import {
  addEpisode,
  datesIn,
  dueRollup,
  type EpisodesState,
  type Span,
} from './episodes.ts'

const stateOf = (...episodes: [Span, string, string?][]) => {
  const state: EpisodesState = { episodes: [], next: 1 }
  for (const [span, start, end = start] of episodes)
    addEpisode(state, { span, start, end, text: `${span} ${start}`, at: 0 })
  return state
}

const due = (state: EpisodesState, today: string) => {
  const rollup = dueRollup(state, today)
  return rollup && [rollup.span, rollup.start, rollup.end, rollup.days.length]
}

test('a week rolls up once it has ended, from its day episodes', () => {
  // Wednesday 5 and Sunday 9 March 2025 are in the week of Monday 3 March.
  const state = stateOf(['day', '2025-03-05'], ['day', '2025-03-09'])
  expect(due(state, '2025-03-09')).toBeUndefined()
  expect(due(state, '2025-03-10')).toEqual([
    'week',
    '2025-03-03',
    '2025-03-09',
    2,
  ])
  addEpisode(state, {
    span: 'week',
    start: '2025-03-03',
    end: '2025-03-09',
    text: 'The week',
    at: 0,
  })
  expect(due(state, '2025-03-10')).toBeUndefined()
})

test('a month rolls up on the 1st, after any week that ends with it', () => {
  // Monday 24 to Sunday 30 November 2025 ends the day before the month does.
  const state = stateOf(
    ['day', '2025-11-26'],
    ['week', '2025-11-24', '2025-11-30'],
  )
  expect(due(state, '2025-11-30')).toBeUndefined()
  expect(due(state, '2025-12-01')).toEqual([
    'month',
    '2025-11-01',
    '2025-11-30',
    1,
  ])
  // A week and a month ending the same day: the week first.
  const both = stateOf(['day', '2025-08-31'])
  expect(due(both, '2025-09-01')?.[0]).toBe('week')
})

test('missed passes are caught up oldest first', () => {
  const state = stateOf(
    ['day', '2025-01-08'],
    ['day', '2025-01-15'],
    ['day', '2025-02-04'],
  )
  expect(due(state, '2025-03-01')).toEqual([
    'week',
    '2025-01-06',
    '2025-01-12',
    1,
  ])
})

test('days with no conversation need no rollup', () => {
  expect(due(stateOf(), '2025-03-10')).toBeUndefined()
  expect(localDay(new Date(2025, 2, 9, 23, 59).getTime())).toBe('2025-03-09')
})

test('an episode spanning a new week or month counts towards both', () => {
  // Familiar was off from Friday 30 January to Tuesday 3 February 2026.
  const state = stateOf(['day', '2026-01-30', '2026-02-03'])
  const order: unknown[] = []
  for (let rollup = dueRollup(state, '2026-03-02'); rollup;) {
    order.push([rollup.span, rollup.start, rollup.days.length])
    addEpisode(state, { ...rollup, text: '', at: 0 })
    rollup = dueRollup(state, '2026-03-02')
  }
  expect(order).toEqual([
    ['month', '2026-01-01', 1],
    ['week', '2026-01-26', 1],
    ['week', '2026-02-02', 1],
    ['month', '2026-02-01', 1],
  ])
})

test('a message names dates only explicitly, and past ones without a year', () => {
  const today = '2026-02-09'
  const ranges = (text: string) =>
    datesIn(text, today).map(({ start, end }) => `${start}..${end}`)
  expect(ranges('What was going on in March?')).toEqual([
    '2025-03-01..2025-03-31',
  ])
  expect(ranges('What happened on 4 March?')).toEqual([
    '2025-03-04..2025-03-04',
  ])
  expect(ranges('And on February 3rd, 2026?')).toEqual([
    '2026-02-03..2026-02-03',
  ])
  expect(ranges('What about early January?')).toEqual([
    '2026-01-01..2026-01-31',
  ])
  expect(ranges('Remind me what I said on 2025-12-01')).toEqual([
    '2025-12-01..2025-12-01',
  ])
  expect(ranges('June 2024 was busy')).toEqual(['2024-06-01..2024-06-30'])
  // Words that only look like dates.
  for (const text of [
    'It may rain later',
    'May I ask something?',
    'A perfect match',
    'Chess club on Friday at 3',
    'I march to my own drum',
    'Book it for 31 February',
  ])
    expect(ranges(text), text).toEqual([])
})

test('a message at 1am belongs to the day before', () => {
  expect(upkeepDay(new Date(2026, 1, 10, 1, 0).getTime())).toBe('2026-02-09')
  expect(upkeepDay(new Date(2026, 1, 10, 4, 0).getTime())).toBe('2026-02-10')
})

test('an episode spanning several weeks counts towards each of them', () => {
  // 31 days of failed passes, then one episode for the lot.
  const state = stateOf(['day', '2026-03-02', '2026-04-01'])
  const weeks: string[] = []
  for (let rollup = dueRollup(state, '2026-05-01'); rollup;) {
    if (rollup.span === 'week') weeks.push(rollup.start)
    addEpisode(state, { ...rollup, text: '', at: 0 })
    rollup = dueRollup(state, '2026-05-01')
  }
  expect(weeks).toEqual([
    '2026-03-02',
    '2026-03-09',
    '2026-03-16',
    '2026-03-23',
    '2026-03-30',
  ])
})
