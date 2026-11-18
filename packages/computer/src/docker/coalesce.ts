/**
 * Runs `pass` one at a time. Asked while one runs, it returns the single
 * next pass, which starts once that one ends, so any number of requests
 * meanwhile make one more pass. A rejected pass still rejects its callers,
 * but never stops the next one starting.
 *
 * `next` is cleared just before `pass` is called, and `pass` must take what
 * it acts on before its first `await`: then a request either lands before
 * the clear and is seen by this pass, or after it and starts the next.
 */
export function coalesce<T>(pass: () => Promise<T>): () => Promise<T> {
  let settled: Promise<unknown> = Promise.resolve()
  let next: Promise<T> | undefined
  return () =>
    (next ??= settled.then(() => {
      next = undefined
      const running = pass()
      settled = running.catch(() => {})
      return running
    }))
}
