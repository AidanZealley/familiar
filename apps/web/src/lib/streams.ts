import { useCallback, useSyncExternalStore } from 'react'

type Stream = { disconnect(): void }

/** The open stores of one kind, by ID, and how to open another. */
export type Pool<S extends Stream> = {
  open(id: number): S
  live: Map<number, { store: S; users: number }>
}

export const pool = <S extends Stream>(open: (id: number) => S): Pool<S> => ({
  open,
  live: new Map(),
})

/**
 * A Familiar's or a room's store, shared by every component showing it: the
 * first to mount opens its stream and the last to leave closes it, so a DM
 * and its Familiar's settings read one stream between them. Undefined
 * without an ID, and for the render before the stream opens.
 */
export function useStream<S extends Stream>(
  pool: Pool<S>,
  id: number | undefined,
): S | undefined {
  const subscribe = useCallback(() => {
    if (id === undefined) {
      return () => {}
    }
    const entry = pool.live.get(id) ?? { store: pool.open(id), users: 0 }
    entry.users += 1
    pool.live.set(id, entry)
    return () => {
      entry.users -= 1
      if (entry.users === 0) {
        entry.store.disconnect()
        pool.live.delete(id)
      }
    }
  }, [pool, id])
  return useSyncExternalStore(subscribe, () =>
    id === undefined ? undefined : pool.live.get(id)?.store,
  )
}
