import { setTimeout } from 'node:timers/promises'
import type { Workspace } from '@familiar-ai/core'
import type { ReplyData } from '@familiar-ai/core'
import type { createClock } from './clock.ts'
import type { Meter } from './model.ts'

/** Timers due within this long fire even while work runs: Pi's retry backoff, never the nightly memory clock. */
const BACKOFF = 5 * 60 * 1000
/** How long, in real time, such a timer stands before it is fired. */
const STOOD = 3_000

/**
 * Waits until no work runs, firing timers that fall due before `limit`, such
 * as a retry's backoff, on the eval clock. Throws once the meter has stopped
 * the run, whether for its cap or a usage limit.
 */
export async function settle(
  workspace: Workspace,
  clock: ReturnType<typeof createClock>,
  meter: Meter,
  limit: number,
) {
  // Work started by a timer shows as active only once it's scheduled, so
  // idle must hold for a few looks in a row.
  let waiting: { due: number; since: number } | undefined
  for (let idle = 0; idle < 3;) {
    meter.check()
    await setTimeout(idle ? 20 : 50)
    const due = clock.nextDue()
    if (workspace.wake().active) {
      // Work that waits on a short timer, such as a failed request's retry
      // backoff, stays active, so it would wait for the clock for ever. A
      // timer that has stood this long is fired; one only just set is left,
      // so the clock barely moves while a request streams.
      if (due !== waiting?.due) {
        waiting = { due, since: Date.now() }
      } else if (
        due <= clock.now() + BACKOFF &&
        Date.now() - waiting.since >= STOOD
      ) {
        clock.advanceTo(Math.max(due, clock.now()))
        waiting = undefined
      }
      idle = 0
      continue
    }
    waiting = undefined
    if (due < limit) {
      clock.advanceTo(Math.max(due, clock.now()))
      idle = 0
      continue
    }
    idle++
  }
  meter.check()
}

/** The text of a reply's assistant messages. */
export const replyText = (messages: ReplyData['messages']): string =>
  messages
    .flatMap((message) =>
      message.role === 'assistant' && Array.isArray(message.content)
        ? message.content.flatMap((part) =>
            part.type === 'text' ? [part.text] : [],
          )
        : [],
    )
    .join('\n')
    .trim()

/** `work`, or an error if it takes longer than `ms` of real time or the meter stops the run. */
export async function within<T>(
  ms: number,
  message: string,
  work: Promise<T>,
  meter: Meter,
) {
  const timeout = new AbortController()
  try {
    return await Promise.race([
      work,
      meter.stopped,
      setTimeout(ms, undefined, { signal: timeout.signal }).then(() => {
        throw new Error(message)
      }),
    ])
  } finally {
    timeout.abort()
  }
}
