import { expect, test } from 'vitest'
import { describeRepeat } from './schedules.ts'

test('repeats read as words, or as written when unusual', () => {
  expect(
    describeRepeat('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=7;BYMINUTE=0'),
  ).toBe('Weekdays at 07:00')
  expect(describeRepeat('FREQ=WEEKLY;BYDAY=SA,SU;BYHOUR=9;BYMINUTE=30')).toBe(
    'Weekends at 09:30',
  )
  expect(describeRepeat('FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=18;BYMINUTE=0')).toBe(
    'Every Mon, Wed at 18:00',
  )
  expect(describeRepeat('RRULE:FREQ=DAILY;BYHOUR=18;BYMINUTE=5')).toBe(
    'Every day at 18:05',
  )
  expect(describeRepeat('FREQ=DAILY;INTERVAL=2;BYHOUR=8;BYMINUTE=0')).toBe(
    'Every 2 days at 08:00',
  )
  expect(describeRepeat('FREQ=HOURLY;BYMINUTE=15')).toBe('Every hour at :15')
  expect(describeRepeat('FREQ=MONTHLY;BYMONTHDAY=22;BYHOUR=9;BYMINUTE=0')).toBe(
    'Every month on the 22nd at 09:00',
  )
  const unusual = 'FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=14;BYHOUR=9;BYMINUTE=0'
  expect(describeRepeat(unusual)).toBe(unusual)
  expect(describeRepeat(undefined)).toBeUndefined()
})
