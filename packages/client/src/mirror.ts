import { applyImmutable } from '@earendil-works/chord/delta'
import type { DocumentName, Documents } from '@familiar-ai/core/http'
import type { StoreApi } from 'zustand/vanilla'
import { openEvents, type Connection } from './events.ts'

export type StoreOptions = {
  /**
   * Makes every request: each API call, the event stream, and each of the
   * stream's reconnects, so a host can attach a fresh credential each time.
   * It gets the URL and an init with the method, body, headers and abort
   * signal to pass on. Defaults to the platform's `fetch`.
   */
  fetch?: typeof fetch
}

/** Each streamed document under its wire name, undefined until received. */
export type MirroredDocuments<Name extends DocumentName> = {
  [Key in Name]: Readonly<Documents[Key]> | null | undefined
}

/**
 * Read state with `getState` and `subscribe`, or `useStore` from zustand.
 * Change it only through the commands, which never change identity.
 * `disconnect` closes the stream and pending reconnects, keeping the last
 * state.
 */
export type Store<State> = Pick<
  StoreApi<State>,
  'getState' | 'getInitialState' | 'subscribe'
> & { disconnect(): void }

/** The host's fetch, or the global one called by name. */
export const fetchOf = (options: StoreOptions): typeof globalThis.fetch =>
  // Browsers reject an unbound `fetch`, and a later polyfill or stub still counts.
  options.fetch ?? ((input, init) => globalThis.fetch(input, init))

/**
 * A live mirror of one `/events` stream: its connection, and every document
 * it sends, by name, through `receive` when a document changes more state
 * than its own. What else the stream carries, such as a room's log, the
 * caller wires up with `on`.
 */
export function openMirror<State extends { connection: Connection }>(
  url: string,
  fetch: typeof globalThis.fetch,
  store: StoreApi<State>,
  receive = (name: DocumentName, value: unknown): object => ({
    [name]: value,
  }),
) {
  const set = store.setState as (partial: object) => void
  const events = openEvents(url, fetch, (connection) => set({ connection }))
  events.on('document', ({ name, value }) => set(receive(name, value)))
  events.on('document.ops', ({ name, ops }) =>
    set(
      receive(
        name,
        applyImmutable(
          (store.getState() as Record<string, unknown>)[name] ?? undefined,
          ops,
        ),
      ),
    ),
  )
  return {
    on: events.on,
    /** The store's reading half, with `disconnect`. */
    readable: {
      getState: store.getState,
      getInitialState: store.getInitialState,
      subscribe: store.subscribe,
      disconnect: events.disconnect,
    } satisfies Store<State>,
  }
}
