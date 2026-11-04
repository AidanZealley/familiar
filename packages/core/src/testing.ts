import { createModels } from '@earendil-works/pi-ai/models'
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux'
import { MemoryStorage, type SetTimer } from '@earendil-works/pi-durable'
import { onTestFinished } from 'vitest'
import { summonFamiliar, type FamiliarOptions } from './familiar.ts'
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

/** Models whose only provider is `faux`, which scripts what they say. */
export function fauxModels() {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  return { faux, models }
}

/** A Familiar on faux models and memory storage, dismissed after the test. */
export async function testFamiliar(options: Partial<FamiliarOptions> = {}) {
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models: fauxModels().models,
    model: { provider: 'faux', modelId: 'faux-1' },
    timeZone: 'UTC',
    ...options,
  })
  onTestFinished(() => familiar.dismiss())
  return familiar
}
