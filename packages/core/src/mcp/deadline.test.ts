import { afterEach, expect, test, vi } from 'vitest'
import { idleDeadline } from './deadline.ts'

afterEach(() => vi.useRealTimers())

// A call may wait on the person for as long as they take, but not on a
// server that's gone quiet.
test('the deadline waits while paused and fires once the call goes quiet', () => {
  vi.useFakeTimers()
  const deadline = idleDeadline(60_000, undefined)
  vi.advanceTimersByTime(59_000)
  deadline.restart()
  vi.advanceTimersByTime(59_000)
  deadline.pause()
  vi.advanceTimersByTime(10 * 60_000)
  expect(deadline.signal.aborted).toBe(false)
  deadline.resume()
  vi.advanceTimersByTime(59_000)
  expect(deadline.signal.aborted).toBe(false)
  vi.advanceTimersByTime(1_000)
  expect(deadline.signal.aborted).toBe(true)
  expect(deadline.expired).toBe(true)
})

test("the caller's abort ends it without counting as expiry", () => {
  const caller = new AbortController()
  const deadline = idleDeadline(60_000, caller.signal)
  caller.abort()
  expect(deadline.signal.aborted).toBe(true)
  expect(deadline.expired).toBe(false)
  deadline.done()
})
