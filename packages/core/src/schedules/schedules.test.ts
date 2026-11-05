import { createModels } from '@earendil-works/pi-ai/models'
import { expect, test } from 'vitest'
import { summonFamiliar } from '../familiar.ts'
import { ReopenableStorage } from '../memory/testing.ts'
import { TEST_ZONE, timeAt } from '../testing.ts'
import { parseMinute } from '../time.ts'
import { latestOccurrence, nextOccurrence, repeatProblem } from './repeat.ts'
import {
  addSchedule,
  advance,
  DEFAULT_MAX_SCHEDULES,
  dueAt,
  SCHEDULE_LIMITS,
  upcoming,
} from './schedules.ts'

// The rules for adding, timing and advancing schedules, and how repeats are
// read. Delivery, end to end, is in task.test.ts.

const pad = (value: number) => String(value).padStart(2, '0')

/** A time in October 2026 in TEST_ZONE, where the clocks go back on the 25th. */
const at = (day: number, hour: number, minute = 0) =>
  timeAt(`2026-10-${pad(day)} ${pad(hour)}:${pad(minute)}`)

/** Wednesday 21 October 2026, local noon. */
const start = at(21, 12)

const HOUR = 60 * 60 * 1000

/** A repeat's first `count` times, as a schedule added at `created` has them. */
const upcomingFrom = (
  repeat: string,
  created: number,
  count: number,
  timeZone = TEST_ZONE,
) =>
  upcoming(
    addSchedule(
      {},
      { id: 's1', prompt: 'Stretch', repeat },
      created,
      timeZone,
      DEFAULT_MAX_SCHEDULES,
    ),
    count,
    timeZone,
  )

test('repeats keep their local time across clock changes: a skipped minute runs when the clock resumes, and hourly ones stay an hour apart', () => {
  {
    // The clocks go back at 02:00 on Sunday 25 October, so that day is 25 hours.
    expect(at(25, 7) - at(24, 7)).toBe(25 * 60 * 60 * 1000)
    const daily = '0 7 * * *'
    expect(nextOccurrence(daily, at(24, 8), TEST_ZONE)).toBe(at(25, 7))

    // Every day at 07:00 local, through the 25-hour Sunday.
    expect(upcomingFrom(daily, start, 5)).toEqual(
      [22, 23, 24, 25, 26].map((day) => at(day, 7)),
    )
  }
  {
    // London's clocks go forward from 01:00 to 02:00 on 29 March 2026, so
    // 01:30 doesn't happen that day; Croner runs it at 02:00.
    const daily = '30 1 * * *'
    const created = timeAt('2026-03-27 12:00')
    expect(upcomingFrom(daily, created, 3)).toEqual([
      timeAt('2026-03-28 01:30'),
      timeAt('2026-03-29 02:00'),
      timeAt('2026-03-30 01:30'),
    ])
    const after = timeAt('2026-03-29 02:10')
    expect(nextOccurrence(daily, after, TEST_ZONE)).toBe(
      timeAt('2026-03-30 01:30'),
    )
    expect(latestOccurrence(daily, after, TEST_ZONE)).toBe(
      timeAt('2026-03-29 02:00'),
    )
  }
  {
    const hourly = '30 * * * *'
    const created = Date.UTC(2026, 9, 24, 22)
    const times = upcomingFrom(hourly, created, 5)
    // 01:30 is shown twice that night, an hour apart, and an hourly repeat
    // runs at both.
    expect(times.map((time) => new Date(time).toISOString())).toEqual([
      '2026-10-24T22:30:00.000Z',
      '2026-10-24T23:30:00.000Z',
      '2026-10-25T00:30:00.000Z',
      '2026-10-25T01:30:00.000Z',
      '2026-10-25T02:30:00.000Z',
    ])
    const repeated = Date.UTC(2026, 9, 25, 1, 40)
    expect(nextOccurrence(hourly, repeated, TEST_ZONE)).toBe(
      Date.UTC(2026, 9, 25, 2, 30),
    )
    expect(latestOccurrence(hourly, repeated, TEST_ZONE)).toBe(
      Date.UTC(2026, 9, 25, 1, 30),
    )
    // A daily repeat at 01:30 runs that night only at the first.
    expect(upcomingFrom('30 1 * * *', created, 3)).toEqual([
      Date.UTC(2026, 9, 25, 0, 30),
      Date.UTC(2026, 9, 26, 1, 30),
      Date.UTC(2026, 9, 27, 1, 30),
    ])
  }
  {
    // Lord Howe Island's clocks go back half an hour at 02:00 on 5 April 2026,
    // so 01:30 happens twice, half an hour apart, and Croner has both.
    const zone = 'Australia/Lord_Howe'
    const hourly = '30 * * * *'
    const first = Date.parse('2026-04-04T14:30:00Z')
    expect(nextOccurrence(hourly, first, zone)).toBe(
      Date.parse('2026-04-04T15:00:00Z'),
    )

    // Familiar skips the second 01:30, half an hour after the first.
    const created = Date.parse('2026-04-04T13:00:00Z')
    const times = upcomingFrom(hourly, created, 4, zone)
    expect(times.map((time) => new Date(time).toISOString())).toEqual([
      '2026-04-04T13:30:00.000Z',
      '2026-04-04T14:30:00.000Z',
      '2026-04-04T16:00:00.000Z',
      '2026-04-04T17:00:00.000Z',
    ])
    const schedules = {
      s1: { id: 's1', prompt: 'Stretch', repeat: hourly, created, next: first },
    }
    expect(advance(schedules, 's1', first, first + 60_000, zone)?.next).toBe(
      Date.parse('2026-04-04T16:00:00Z'),
    )
  }
})

test('a one-off at a minute that does not exist or the clock skips is refused, and one it shows twice is the first', () => {
  {
    // Dates roll over in JavaScript, so only an exact round trip is accepted.
    expect(() =>
      addSchedule(
        {},
        { id: 's1', prompt: 'Stretch', at: '2026-02-30 09:00' },
        start,
        TEST_ZONE,
        DEFAULT_MAX_SCHEDULES,
      ),
    ).toThrow('that exists')
  }
  {
    // London's clocks go forward from 01:00 to 02:00 on 29 March 2026.
    expect(parseMinute('2026-03-29 01:30', TEST_ZONE)).toBeUndefined()
    expect(() =>
      addSchedule(
        {},
        { id: 's1', prompt: 'Stretch', at: '2026-03-29 01:30' },
        Date.UTC(2026, 2, 1),
        TEST_ZONE,
        DEFAULT_MAX_SCHEDULES,
      ),
    ).toThrow('that exists in Europe/London')
    // They go back from 02:00 to 01:00 on 25 October, so 01:30 happens twice.
    expect(parseMinute('2026-10-25 01:30', TEST_ZONE)).toBe(
      Date.UTC(2026, 9, 25, 0, 30),
    )
    expect(parseMinute('2026-10-25 01:30', 'Asia/Tokyo')).toBe(
      Date.UTC(2026, 9, 24, 16, 30),
    )
    expect(parseMinute('2026-10-25 1:30', TEST_ZONE)).toBeUndefined()
  }
})

test('an occurrence exactly at a time is the latest by then, not the next after it', () => {
  const daily = '0 18 * * *'
  expect(latestOccurrence(daily, at(24, 18), TEST_ZONE)).toBe(at(24, 18))
  expect(latestOccurrence(daily, at(24, 18) - 500, TEST_ZONE)).toBe(at(23, 18))
  expect(nextOccurrence(daily, at(24, 18), TEST_ZONE)).toBe(at(25, 18))
  expect(nextOccurrence(daily, at(24, 18) - 500, TEST_ZONE)).toBe(at(24, 18))

  // Missed since Wednesday, it's due at the latest occurrence, Saturday's.
  const schedule = addSchedule(
    {},
    { id: 's1', prompt: 'Stretch', repeat: daily },
    start,
    TEST_ZONE,
    DEFAULT_MAX_SCHEDULES,
  )
  expect(schedule.next).toBe(at(21, 18))
  expect(dueAt(schedule, at(24, 18), TEST_ZONE)).toBe(at(24, 18))
  expect(dueAt(schedule, at(24, 18) - 500, TEST_ZONE)).toBe(at(23, 18))
  // Woken just before its first time, it's still that time.
  expect(dueAt(schedule, at(21, 17, 59), TEST_ZONE)).toBe(at(21, 18))
})

test('a repeat previews its next times, skipping the weekend and spacing out more than hourly', () => {
  {
    // Wednesday noon: Thursday, Friday, then Monday at 07:00.
    expect(upcomingFrom('0 7 * * 1-5', start, 3)).toEqual([
      at(22, 7),
      at(23, 7),
      at(26, 7),
    ])
  }
  {
    expect(upcomingFrom('*/5 * * * *', start, 3)).toEqual([
      at(21, 12, 5),
      at(21, 13, 5),
      at(21, 14, 5),
    ])
    const schedules = {
      s1: {
        id: 's1',
        prompt: 'Stretch',
        repeat: '*/5 * * * *',
        created: start,
        next: at(21, 12, 5),
      },
    }
    // Delivered late, at 12:40, it still waits an hour from 12:05.
    expect(
      advance(schedules, 's1', at(21, 12, 5), at(21, 12, 40), TEST_ZONE)?.next,
    ).toBe(at(21, 13, 5))
  }
})

test.each([
  // Not five fields.
  'not a repeat',
  '0 7 * *',
  '0 0 7 * * *',
  // Fields Croner can't read.
  '*/0 * * * *',
  '60 * * * *',
  '0 24 * * *',
  '0 7 32 * *',
  '0 7 * 13 *',
  '0 7 * * 8',
])('a repeat that is not five-field cron is refused: %s', (repeat) => {
  const problem = repeatProblem(repeat, TEST_ZONE)
  expect(problem).toContain('five-field cron')
  expect(() =>
    addSchedule(
      {},
      { id: 's1', prompt: 'Stretch', repeat },
      start,
      TEST_ZONE,
      DEFAULT_MAX_SCHEDULES,
    ),
  ).toThrow(problem)
})

test('malformed, impossible and rare repeats are each worked out promptly, and one that never happens is refused', () => {
  {
    const malformed = [
      'FREQ=HOURLY;BYMINUTE=0;INTERVAL=-1',
      '',
      '*/-1 * * * *',
      '1/0 * * * *',
      '0-61 * * * *',
      '0 0 0 * *',
      `0 7 * * ${'1,'.repeat(130)}1`,
      'x'.repeat(SCHEDULE_LIMITS.repeat + 1),
    ]
    const never = ['0 0 31 2 *', '0 0 30 2 *', '0 0 31 4,6,9,11 *']
    const rare = ['0 9 29 2 *', '0 9 L 2 *', '0 9 * 2 1#5', '0 9 * * 5#5']
    const results = [...malformed, ...never, ...rare].map((repeat) => {
      const began = performance.now()
      const problem = repeatProblem(repeat, TEST_ZONE)
      const next = problem
        ? undefined
        : nextOccurrence(repeat, start, TEST_ZONE)
      const latest = problem
        ? undefined
        : latestOccurrence(repeat, start, TEST_ZONE)
      return { repeat, problem, next, latest, ms: performance.now() - began }
    })
    const of = (repeats: string[]) =>
      results.filter(({ repeat }) => repeats.includes(repeat))
    for (const result of results) {
      expect(result.ms, result.repeat).toBeLessThan(2_000)
    }
    for (const { repeat, problem } of of(malformed)) {
      expect(problem, repeat).toBeDefined()
    }
    for (const { repeat, problem, next, latest } of of(never)) {
      expect({ problem, next, latest }, repeat).toEqual({})
    }
    for (const { repeat, problem, next } of of(rare)) {
      expect(problem, repeat).toBeUndefined()
      expect(next, repeat).toBeGreaterThan(start)
    }
  }
  {
    expect(repeatProblem('0 9 31 2 *', TEST_ZONE)).toBeUndefined()
    expect(() =>
      addSchedule(
        {},
        { id: 's1', prompt: 'Stretch', repeat: '0 9 31 2 *' },
        start,
        TEST_ZONE,
        DEFAULT_MAX_SCHEDULES,
      ),
    ).toThrow('never happens')
  }
})

// Each is timed as it's worked out. A test timeout can't interrupt
// synchronous work, so a repeat that never finished would stall the run
// rather than fail it; the bound catches one that is merely slow.
test.each([
  '30 * * * *',
  '0 */2 * * *',
  '45 7,8,9,22,23 * * *',
  '0 7 * * 1-5',
  // Asking for more often than hourly is spaced out to hourly.
  '*/5 * * * *',
  '* * * * *',
  '0,30 7 * * *',
])('a repeat is at least an hour apart, across clock changes: %s', (repeat) => {
  // Through both of 2026's clock changes in TEST_ZONE.
  for (const from of [timeAt('2026-03-27 00:00'), at(23, 0)]) {
    const times = upcomingFrom(repeat, from, 120)
    for (const [i, time] of times.slice(1).entries()) {
      expect(time - times[i]).toBeGreaterThanOrEqual(HOUR)
    }
  }
})

test('after a move to a half-hour zone, an hourly repeat waits an hour from its last run', () => {
  const due = Date.parse('2026-10-21T12:00:00Z')
  const schedules = {
    s1: {
      id: 's1',
      prompt: 'Stretch',
      repeat: '0 * * * *',
      created: start,
      next: due,
    },
  }
  // :00 in Kolkata is :30 in UTC, so 12:30 is too soon.
  expect(
    advance(schedules, 's1', due, due + 60_000, 'Asia/Kolkata')?.next,
  ).toBe(Date.parse('2026-10-21T13:30:00Z'))
})

test('a schedule is refused past the quota or with an oversized prompt or repeat', () => {
  const schedules = {}
  const add = (id: string, fields: { prompt?: string; repeat?: string }) =>
    addSchedule(
      schedules,
      { id, prompt: 'Stretch', at: '2026-10-22 09:00', ...fields },
      start,
      TEST_ZONE,
      2,
    )
  add('s1', {})
  expect(() =>
    add('s2', { prompt: 'x'.repeat(SCHEDULE_LIMITS.prompt + 1) }),
  ).toThrow(`${SCHEDULE_LIMITS.prompt} characters`)
  expect(() =>
    addSchedule(
      schedules,
      {
        id: 's2',
        prompt: 'Stretch',
        repeat: `0 7 * * ${'1,'.repeat(130)}1`,
      },
      start,
      TEST_ZONE,
      2,
    ),
  ).toThrow(`${SCHEDULE_LIMITS.repeat} characters`)
  add('s2', {})
  expect(() => add('s3', {})).toThrow('already 2 schedules')
  expect(Object.keys(schedules)).toEqual(['s1', 's2'])
})

test.each([0, -1, 1.5, Infinity, Number.NaN])(
  'maxSchedules %s is refused when Familiar opens',
  async (maxSchedules) => {
    await expect(
      summonFamiliar({
        storage: new ReopenableStorage(),
        models: createModels(),
        model: { provider: 'faux', modelId: 'faux-1' },
        timeZone: TEST_ZONE,
        maxSchedules,
      }),
    ).rejects.toThrow('maxSchedules must be a positive whole number')
  },
)
