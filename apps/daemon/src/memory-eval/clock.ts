import type { SetTimer } from '@earendil-works/pi-durable'

/** Only the simulated clock owns time; real model latency never advances it. */
export function createClock(start: number) {
  let now = start
  const timers = new Set<{ due: number; fire: () => void }>()
  const setTimer: SetTimer = (fire, delay, { background }) => {
    if (background) return undefined // Pi's cache eviction needs no simulated timer.
    const timer = { due: now + delay, fire }
    timers.add(timer)
    return () => {
      timers.delete(timer)
    }
  }
  return {
    now: () => now,
    setTimer,
    advanceTo(time: number) {
      if (time < now) throw new Error('The eval clock cannot run backwards.')
      now = time
      for (const timer of [...timers]) {
        if (timer.due > now) continue
        timers.delete(timer)
        timer.fire()
      }
    },
  }
}
