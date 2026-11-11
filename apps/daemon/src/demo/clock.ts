/**
 * The demo workspace's clock (its `now` option): real time, less however
 * far back the seed is. The seed starts it days ago and moves it forward as
 * it plays the household's history, so what it posts is dated then; once
 * it's done the clock is real time again. It only ever moves forward, as a
 * laptop waking from sleep would.
 */
export type DemoClock = {
  now(): number
  /** Moves the clock forward to `at`, from where it keeps ticking. */
  set(at: number): void
  /** Real time from here on. */
  resume(): void
  /** Whether it's behind real time: the seed is still writing the past. */
  catchingUp(): boolean
}

export function demoClock(start: number): DemoClock {
  let behind = Date.now() - start
  const now = () => Date.now() - behind
  return {
    now,
    set: (at) => {
      behind = Math.min(behind, Math.max(0, Date.now() - at))
    },
    resume: () => {
      behind = 0
    },
    catchingUp: () => behind > 0,
  }
}
