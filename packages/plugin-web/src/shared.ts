/** How long a search may take, reading the body included. */
export const TIMEOUT_MS = 15_000

const pad = (value: number) => String(value).padStart(2, '0')

/** A time as `2026-10-28 14:05`, in local time, as Familiar writes times. */
export const timestamp = (at: number) => {
  const date = new Date(at)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** At most `max` characters, ending in … when cut. */
export const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text

/** The longest title a search result shows. */
export const MAX_TITLE = 300

/**
 * Runs `run` with a signal that aborts after `ms` or with the call, and
 * reports the timeout in words the model can act on.
 */
export async function withTimeout<T>(
  ms: number,
  call: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeout = AbortSignal.timeout(ms)
  const signal = call ? AbortSignal.any([call, timeout]) : timeout
  try {
    return await run(signal)
  } catch (error) {
    if (timeout.aborted) {
      throw new Error(`No answer within ${ms / 1000} seconds.`, {
        cause: error,
      })
    }
    throw error
  }
}
