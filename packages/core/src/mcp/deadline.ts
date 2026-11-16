/**
 * A deadline for a call that may go on for as long as it shows signs of
 * life: it aborts `signal` once `ms` pass without a `restart`, never while
 * paused, such as while the person answers the server's question. The
 * caller's `parent` signal aborts it too.
 */
export function idleDeadline(ms: number, parent: AbortSignal | undefined) {
  const controller = new AbortController()
  const signal = parent
    ? AbortSignal.any([parent, controller.signal])
    : controller.signal
  let timer: ReturnType<typeof setTimeout> | undefined
  let paused = 0
  let expired = false
  const restart = () => {
    clearTimeout(timer)
    if (paused === 0 && !signal.aborted) {
      timer = setTimeout(() => {
        expired = true
        controller.abort(new Error('The call went quiet for too long.'))
      }, ms)
    }
  }
  restart()
  return {
    signal,
    get expired() {
      return expired
    },
    /** The call showed signs of life. */
    restart,
    pause: () => {
      paused += 1
      clearTimeout(timer)
    },
    resume: () => {
      paused -= 1
      restart()
    },
    done: () => {
      paused = Infinity
      clearTimeout(timer)
    },
  }
}

export type IdleDeadline = ReturnType<typeof idleDeadline>
