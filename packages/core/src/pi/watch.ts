import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { diffRevisions, type JsonValue } from '@earendil-works/chord/delta'
import { Watch, type WatchHandle } from '@earendil-works/chord/watch'

/** Familiar owns the projection and its sources; Chord owns watch delivery and lifetime. */
export function derivedWatch<T extends JsonValue>(compute: () => T) {
  let latest = compute()
  let sources: Set<WatchHandle<unknown>> | undefined = new Set()
  const watch = new Watch<T>(
    latest,
    () => {
      const attached = sources
      sources = undefined
      for (const source of attached ?? []) {
        void source.stop()
      }
    },
    () => {},
  )

  const update = () => {
    if (!sources) {
      return
    }
    const next = compute()
    const ops = diffRevisions(latest, next)
    latest = next
    if (ops.length) {
      watch.advance(
        { kind: 'value', value: next, ops, retired: false },
        BACKGROUND_CONTEXT,
      )
    }
  }

  return {
    watch,
    /** Follows a source, with `before` attaching any new sources it introduces. */
    follow: <S>(source: WatchHandle<S>, before?: () => void) => {
      if (!sources) {
        void source.stop()
        return false
      }
      sources.add(source as WatchHandle<unknown>)
      void source.closed.then((end) => watch.end(end))
      source.start(async () => {
        before?.()
        update()
      })
      before?.()
      update()
      return true
    },
    end: () => watch.end({ kind: 'aborted' }),
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
