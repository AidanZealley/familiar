import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  diffRevisions,
  type JsonValue,
  type Op,
} from '@earendil-works/chord/delta'
import type { WatchEnd, WatchHandle } from '@earendil-works/pi-durable'

/**
 * A watch of a value computed from other watches, for showing a view of
 * state rather than the state itself, such as a room's share of its
 * Familiars' live state. Each time a source delivers, `compute` runs again
 * over the sources' latest values and the listener gets the ops from the
 * last value it was given, so it streams like any document watch.
 *
 * `follow` adds a source while it runs, `before` running ahead of each
 * recompute, such as to follow more sources. Any source ending ends it, and
 * stopping it stops every source.
 */
export function derivedWatch<T extends JsonValue>(compute: () => T) {
  const sources = new Set<WatchHandle<unknown>>()
  let listener: ((value: T, ops: readonly Op[]) => Promise<void>) | undefined
  // What the listener was last given, or the acquisition value before start.
  let sent = compute()
  let latest = sent
  let delivering = Promise.resolve()
  let ended = false
  let close!: (end: WatchEnd) => void
  const closed = new Promise<WatchEnd>((resolve) => (close = resolve))

  const end = (result: WatchEnd) => {
    if (ended) {
      return
    }
    ended = true
    for (const source of sources) {
      void source.stop()
    }
    close(result)
  }

  const flush = () => {
    if (!listener || ended) {
      return
    }
    const next = latest
    const ops = diffRevisions(sent, next)
    if (!ops.length) {
      return
    }
    sent = next
    const deliver = listener
    delivering = delivering
      .then(() => deliver(next, ops))
      .catch((error: unknown) =>
        end({
          reason: 'listener_error',
          error: error instanceof Error ? error : new Error(String(error)),
        }),
      )
  }

  const update = () => {
    if (!ended) {
      latest = compute()
      flush()
    }
  }

  const watch: WatchHandle<T> = {
    get value() {
      return sent
    },
    start: (next) => {
      listener = (value, ops) => next(value, ops, BACKGROUND_CONTEXT)
      // Anything that changed since acquisition.
      queueMicrotask(flush)
    },
    stop: () => {
      end({ reason: 'stopped' })
      return closed
    },
    closed,
  }

  return {
    watch,
    /**
     * Recomputes whenever `source` delivers, after `before`, until this
     * watch ends. Returns false, stopping `source`, if it already has.
     */
    follow: <S>(source: WatchHandle<S>, before?: () => void) => {
      if (ended) {
        void source.stop()
        return false
      }
      sources.add(source as WatchHandle<unknown>)
      void source.closed.then(end, () => end({ reason: 'cancelled' }))
      source.start(async () => {
        before?.()
        update()
      })
      before?.()
      update()
      return true
    },
    /** Ends it, as when a source can't be opened. */
    end: () => end({ reason: 'cancelled' }),
  }
}

/** `source`'s value through `view`, as a watch. */
export function viewWatch<S, T extends JsonValue>(
  source: WatchHandle<S>,
  view: (value: S) => T,
): WatchHandle<T> {
  const derived = derivedWatch(() => view(source.value))
  derived.follow(source)
  return derived.watch
}
