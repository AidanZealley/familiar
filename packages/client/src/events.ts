import { EventSource, type FetchLike } from 'eventsource'
import type {
  PROTOCOL_VERSION as CoreProtocolVersion,
  StreamEvent,
} from '@familiar-ai/core/http'

// Core's version, typed against it without loading its runtime, so a bump
// there fails this check until the client is updated to match.
const PROTOCOL_VERSION: typeof CoreProtocolVersion = 3

/**
 * The event stream's state. It goes `open` when the server's handshake
 * matches, before its first values arrive.
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

/** Opens the `/events` stream at `url` and mirrors its handshake into `connection`. */
export const openEvents = (
  url: string,
  fetch: typeof globalThis.fetch,
  connection: (value: Connection) => void,
) => {
  const listeners = new AbortController()
  let accepted = false
  const outdated = () => {
    listeners.abort()
    events.close()
    connection('outdated')
  }
  const events = new EventSource(url, {
    fetch: (url, init) => connect(fetch, url, init),
  })
  // EventSource fires open before reading each response, including reconnects.
  events.addEventListener(
    'open',
    () => {
      accepted = false
    },
    { signal: listeners.signal },
  )
  events.addEventListener(
    'protocol',
    ({ data }) => {
      try {
        accepted = JSON.parse(data).version === PROTOCOL_VERSION
      } catch {
        // Unreadable, so not a version this client speaks.
      }
      if (accepted) {
        connection('open')
      } else {
        outdated()
      }
    },
    { signal: listeners.signal },
  )
  const on = <E extends Exclude<StreamEvent['event'], 'protocol'>>(
    event: E,
    handle: (data: Extract<StreamEvent, { event: E }>['data']) => void,
  ) =>
    events.addEventListener(
      event,
      (message) => {
        if (!accepted) {
          outdated()
          return
        }
        handle(JSON.parse(message.data))
      },
      { signal: listeners.signal },
    )

  // EventSource reconnects by itself unless it has closed, and the server
  // answers each reconnect with fresh values.
  events.addEventListener(
    'error',
    ({ code }) =>
      connection(
        events.readyState !== EventSource.CLOSED
          ? 'reconnecting'
          : code === 401 || code === 403
            ? 'unauthorized'
            : 'failed',
      ),
    { signal: listeners.signal },
  )

  return {
    on,
    disconnect: () => {
      listeners.abort()
      events.close()
    },
  }
}

/**
 * Opens the event stream through the host's fetch. EventSource gives up on
 * any status but 200, as the spec says, so server errors and rate limits
 * throw here and it retries them like a dropped connection instead.
 *
 * EventSource's close only aborts the request's signal; it never cancels a
 * body it already has, and in-process hosts such as Hono's `app.fetch`
 * ignore that signal. Piping the body with it cancels the producer on
 * disconnect, whether the response is still on its way, being handed over
 * or being read.
 */
const connect = async (
  fetch: typeof globalThis.fetch,
  ...[url, init]: Parameters<FetchLike>
) => {
  const response = await fetch(url, init)

  if (response.status >= 500 || response.status === 429) {
    void response.body?.cancel().catch(() => {})
    throw new Error(`${url} failed: ${response.status}`)
  }

  // FetchLike needs only these fields. Preserve redirect metadata while the
  // platform pipe owns cancellation, even after EventSource locks its reader.
  return {
    url: response.url,
    status: response.status,
    redirected: response.redirected,
    headers: response.headers,
    body:
      response.body?.pipeThrough(new TransformStream(), {
        signal: init.signal,
      }) ?? null,
  }
}
