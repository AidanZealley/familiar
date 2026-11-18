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
     */
    run: async <T>(
      tool: string,
      args: Record<string, unknown>,
      call: () => Promise<T>,
    ): Promise<T | undefined> => {
      if (asleep) {
        return undefined
      }
      clearTimeout(timer)
      const running = { tool, target: targetOf(args) }
      calls.add(running)
      try {
        return await call()
      } finally {
        calls.delete(running)
        if (!calls.size) {
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
