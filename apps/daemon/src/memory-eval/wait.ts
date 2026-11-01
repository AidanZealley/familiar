import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Storage } from '@earendil-works/pi-durable'
import type { Familiar } from '@familiar-ai/core'
import { clearTimeout, setTimeout as armTimeout } from 'node:timers'
import { setTimeout } from 'node:timers/promises'
import { createClock } from './clock.ts'

export const WAIT_MS = 10 * 60_000
const context = BACKGROUND_CONTEXT

/**
 * Give asynchronous work time to arm retries, then fire only timers before the
 * next scripted event. Fails after `timeoutMs` without progress: each event
 * from `onProgress` (for example `familiar.onCommit`) restarts the deadline.
 */
export async function waitWithClock(
  clock: ReturnType<typeof createClock>,
  boundary: number,
  label: string,
  check: () => Promise<boolean>,
  timeoutMs = WAIT_MS,
  onProgress?: (listener: () => void) => () => void,
) {
  let stopped = false
  let timer: ReturnType<typeof armTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = armTimeout(
      () =>
        reject(
          new Error(
            `${label} timed out after ${timeoutMs / 1000}s of inactivity at simulated ${new Date(clock.now()).toISOString()}.`,
          ),
        ),
      timeoutMs,
    )
  })
  const unsubscribe = onProgress?.(() => timer?.refresh())
  try {
    await Promise.race([
      (async () => {
        while (!stopped && !(await check())) {
          if (stopped) {
            return
          }
          await setTimeout(25)
          if (stopped) {
            return
          }
          const due = clock.nextDue()
          if (due < boundary && due >= clock.now()) {
            clock.advanceTo(due)
          }
        }
      })(),
      timeout,
    ])
  } finally {
    stopped = true
    unsubscribe?.()
    clearTimeout(timer)
  }
}

export async function waitForIdle(
  familiar: Familiar,
  clock: ReturnType<typeof createClock>,
  boundary: number,
  label: string,
) {
  let settled = false
  let failure: unknown
  void familiar.idle().then(
    () => {
      settled = true
    },
    (error: unknown) => {
      failure = error
      settled = true
    },
  )
  await waitWithClock(
    clock,
    boundary,
    label,
    async () => settled,
    WAIT_MS,
    familiar.onCommit,
  )
  if (failure) {
    throw new Error(`${label} failed.`, { cause: failure })
  }
}

export async function waitForUpkeep(
  familiar: Familiar,
  storage: Storage,
  clock: ReturnType<typeof createClock>,
  until: number,
  boundary = until,
) {
  await waitWithClock(
    clock,
    boundary,
    `Memory upkeep before ${new Date(until).toISOString()}`,
    async () => {
      const { items } = await storage.scanTasks(
        { kind: 'familiar.upkeep' },
        2,
        undefined,
        context,
      )
      const state = items[0]?.state
      if (state?.status === 'terminal') {
        throw new Error(`Memory upkeep ended: ${JSON.stringify(state.outcome)}`)
      }
      return (
        items.length === 1 &&
        state?.status === 'sleeping' &&
        state.until === until
      )
    },
    WAIT_MS,
    familiar.onCommit,
  )
}
