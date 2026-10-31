import type { SetTimer } from '@earendil-works/pi-durable'
import { parseMinute } from './time/index.ts'

/** Test helpers; not part of Familiar. */

/** A clock that moves only when told to, firing the timers that fall due. */
export function fakeClock(start: number) {
  let now = start
  let timers: { due: number; fire: () => void }[] = []
  const setTimer: SetTimer = (fire, delayMs, { background }) => {
    if (background) {
      return undefined
    } // only frees memory
    const timer = { due: now + delayMs, fire }
    timers.push(timer)
    return () => {
      timers = timers.filter((other) => other !== timer)
    }
  }
  const advanceTo = (time: number) => {
    now = time
    const due = timers.filter((timer) => timer.due <= now)
    timers = timers.filter((timer) => timer.due > now)
    for (const timer of due) {
      timer.fire()
    }
  }
  return {
    now: () => now,
    setTimer,
    advanceTo,
    setTime: (time: number) => {
      now = time
    },
  }
}

/** The zone tests read calendars in unless they test another. Clocks go back on 2026-10-25. */
export const TEST_ZONE = 'Europe/London'

/** The time of `YYYY-MM-DD HH:MM` in `timeZone`. */
export function timeAt(minute: string, timeZone = TEST_ZONE) {
  const at = parseMinute(minute, timeZone)
  if (at === undefined) {
    throw new Error(`${minute} doesn't exist in ${timeZone}.`)
  }
  return at
}
