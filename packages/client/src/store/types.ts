import type { ConversationView, EntryRecord } from '@earendil-works/pi-durable'
import type { AccountState, Documents } from '@familiar-ai/core/http'
import type { StoreApi } from 'zustand/vanilla'
import type { Commands } from '../commands.ts'
import type { Transcript } from '../transcript.ts'

/**
 * The event stream's state. It goes `open` when a full view arrives.
 * `reconnecting` follows a network error, a stream that ended, or a 5xx or
 * 429 answer, and retries after the server's `retry` delay (3 seconds unless
 * it sets one). `outdated` stops retrying on an incompatible or missing
 * protocol handshake before state arrives. The host decides when to reload.
 * Other terminal states are: `unauthorized` when the stream is
 * answered 401 or 403, and `failed` for any other answer it can't use, such
 * as a 404 or a page that isn't an event stream. To recover from either,
 * disconnect and create a new store.
 */
export type Connection =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'unauthorized'
  | 'failed'
  | 'outdated'

export type FamiliarStoreOptions = {
  /**
   * Makes every request: each API call, the event stream, and each of the
   * stream's reconnects, so a host can attach a fresh credential each time.
   * It gets the URL and an init with the method, body, headers and abort
   * signal to pass on. Defaults to the platform's `fetch`.
   */
  fetch?: typeof fetch
}

/** The conversation before the view, as far back as it has been loaded. */
export type History = {
  /** Committed entries older than any in the view, oldest first. */
  entries: readonly EntryRecord[]
  /**
   * `start` once `entries` reaches the start of the conversation; `failed`
   * if the last load did, until the next one.
   */
  status: 'more' | 'loading' | 'failed' | 'start'
}

export type FamiliarState = {
  connection: Connection
  account: Commands['account'] & {
    /** Undefined until the first frame; null when the host manages credentials. */
    state: AccountState | null | undefined
  }
  conversation: Commands['conversation'] & {
    view: ConversationView | undefined
    history: History
    /** Concurrent callers share the current page request. */
    loadOlder(): Promise<boolean>
  }
  memory: Commands['memory'] & {
    /** Streamed documents, undefined until received. */
    facts: Readonly<Documents['memory']> | null | undefined
    episodes: Readonly<Documents['episodes']> | null | undefined
  }
  schedules: Commands['schedules'] & {
    items: Readonly<Documents['schedules']> | null | undefined
  }
  push: Commands['push']
  connections: Commands['connections']
  mcp: Commands['mcp']
  /** Cached atomically with the conversation; unchanged by unrelated updates. */
  transcript: Transcript | undefined
  /** Closes the stream and pending reconnects, retaining the last state. */
  disconnect(): void
}

/** A read-only store: commands change Familiar, and the stream changes it. */
export type FamiliarStore = Pick<
  StoreApi<FamiliarState>,
  'getState' | 'getInitialState' | 'subscribe'
>
