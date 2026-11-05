import { expect, test, vi } from 'vitest'
import { withStopped } from './index.ts'

test('work runs with a running daemon stopped, which starts again even when the work fails', async () => {
  let running = true
  const service = {
    isRunning: () => running,
    stop: vi.fn(() => {
      running = false
    }),
    start: vi.fn(() => {
      running = true
    }),
  }
  await expect(
    withStopped(service, async () => {
      expect(running).toBe(false)
      throw new Error('login cancelled')
    }),
  ).rejects.toThrow('login cancelled')
  expect(running).toBe(true)

  // A stopped daemon stays stopped.
  running = false
  await withStopped(service, async () => {})
  expect(service.start).toHaveBeenCalledOnce()
})
