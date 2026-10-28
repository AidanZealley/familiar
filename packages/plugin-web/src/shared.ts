/** How long a search or a page read may take, reading the body included. */
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

/** The longest title a search result or page shows. */
export const MAX_TITLE = 300

/**
 * A page read as Markdown, cut to what was asked for: `markdown` is at most
 * `maxChars` characters of the `total` the whole page made.
 */
export type Page = { title?: string; markdown: string; total: number }

/**
 * A page cut where it's made, so a converter elsewhere sends back no more
 * than was asked for, however large the page grew.
 */
export const cutPage = (
  markdown: string,
  maxChars: number,
  title?: string,
): Page => ({
  ...(title ? { title: cut(title, MAX_TITLE) } : {}),
  markdown: markdown.slice(0, maxChars),
  total: markdown.length,
})

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
