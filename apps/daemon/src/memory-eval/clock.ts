import type { SetTimer } from '@earendil-works/pi-durable'

/**
 * The eval's days are this machine's, as they are for the daemon, so the
 * scenario's local noons and Familiar's calendar agree.
 */
export const EVAL_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

/** Noon on a scenario day, `YYYY-MM-DD`, in the eval's time zone: when its message is sent. */
export const noonOf = (date: string) => new Date(`${date}T12:00:00`).getTime()

/** Only the simulated clock owns time; real model latency never advances it. */
export function createClock(start: number) {
  let now = start
  const timers = new Set<{ due: number; fire: () => void }>()
  const setTimer: SetTimer = (fire, delay, { background }) => {
    if (background) {
      return undefined
    } // Pi's cache eviction needs no simulated timer.
    const timer = { due: now + delay, fire }
    timers.add(timer)
    return () => {
      timers.delete(timer)
    }
  }
  return {
    now: () => now,
    setTimer,
    nextDue: () => Math.min(...[...timers].map((timer) => timer.due)),
    advanceTo(time: number) {
      if (time < now) {
        throw new Error('The eval clock cannot run backwards.')
      }
      now = time
      for (const timer of [...timers]) {
        if (timer.due > now) {
          continue
        }
        timers.delete(timer)
        timer.fire()
      }
    },
  }
}
