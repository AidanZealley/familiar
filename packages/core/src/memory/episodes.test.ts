import { expect, test } from 'vitest'
import {
  addEpisode,
  dueRollup,
  localDay,
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
