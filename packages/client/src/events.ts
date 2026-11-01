import { EventSource, type FetchLike } from 'eventsource'
import type { StreamEvent } from '@familiar-ai/core/http'
import type { Connection } from './store.ts'

export const openEvents = (
  baseUrl: string,
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
  const events = new EventSource(`${baseUrl}/events`, {
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
    (message) => {
      try {
        const data: unknown = JSON.parse(message.data)
        if (
          typeof data !== 'object' ||
          data === null ||
          !('version' in data) ||
          data.version !== 1
        ) {
          outdated()
          return
        }
        accepted = true
      } catch {
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
  // answers each reconnect with a fresh view and documents.
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
 * A response that arrives after `disconnect` is dropped here, in case the
 * host's fetch didn't pass the abort signal on. Piping the returned body
 * with that signal also cancels its producer if disconnect happens during
 * the handoff to EventSource or while it is reading.
 */
const connect = async (
  fetch: typeof globalThis.fetch,
  ...[url, init]: Parameters<FetchLike>
) => {
  const response = await fetch(url, init)

  if (init.signal?.aborted) {
    void response.body?.cancel().catch(() => {})
    throw init.signal.reason
  }

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
