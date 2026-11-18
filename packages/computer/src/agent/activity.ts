import type { ComputerCall } from '../host.ts'
import { targetOf, type ComputerInfo } from '../tools.ts'

/**
 * The agent's calls in flight, and when it sleeps: once `idleMs` pass with
 * none, it calls `sleep`, which ends the agent and so stops its computer.
 * From then on it runs nothing more. Without `idleMs` it never sleeps.
 */
export function activity(idleMs: number | undefined, sleep: () => void) {
  /** Calls in flight, oldest first. */
  const calls = new Set<ComputerCall>()
  /** Holds in flight that aren't calls a person sees, such as a take-over. */
  let unlisted = 0
  let lastUsed: string | undefined
  let asleep = false
  let timer: NodeJS.Timeout | undefined
  const rest = () => {
    if (idleMs !== undefined) {
      timer = setTimeout(() => {
        asleep = true
        sleep()
      }, idleMs)
    }
  }
  rest()

  return {
    /**
     * Runs `tool`'s call, keeping the computer awake until it ends, or
     * returns `undefined` without running it once the agent is going to sleep.
     * `call` gets its entry in what the computer is doing. An `unlisted`
     * one keeps it awake without being shown as doing anything.
     */
    run: async <T>(
      tool: string,
      args: Record<string, unknown>,
      call: (running: ComputerCall) => Promise<T>,
      { unlisted: hidden = false } = {},
    ): Promise<T | undefined> => {
      if (asleep) {
        return undefined
      }
      clearTimeout(timer)
      const running = { tool, target: targetOf(args) }
      if (hidden) {
        unlisted++
      } else {
        calls.add(running)
      }
      try {
        return await call(running)
      } finally {
        if (hidden) {
          unlisted--
        } else {
          calls.delete(running)
        }
        if (!calls.size && !unlisted) {
          lastUsed = new Date().toISOString()
          rest()
        }
      }
    },
    /** What it's doing now, or when it was last used. Reading it changes nothing. */
    now: (): Pick<ComputerInfo, 'doing' | 'lastUsed'> =>
      calls.size ? { doing: [...calls] } : { lastUsed },
  }
}

export type Activity = ReturnType<typeof activity>
