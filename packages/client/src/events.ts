import { EventSource, type FetchLike } from 'eventsource'
import { createParser } from 'eventsource-parser'
import type { StreamEvent } from '@familiar-ai/core/http'
import type { Connection } from './store.ts'

export const openEvents = (
  baseUrl: string,
  fetch: typeof globalThis.fetch,
  connection: (value: Connection) => void,
) => {
  const listeners = new AbortController()
  const outdated = () => {
    listeners.abort()
    events.close()
    connection('outdated')
  }
  const events = new EventSource(`${baseUrl}/events`, {
    fetch: (url, init) => connect(fetch, outdated, url, init),
  })
  const on = <E extends StreamEvent['event']>(
    event: E,
    handle: (data: Extract<StreamEvent, { event: E }>['data']) => void,
  ) =>
    events.addEventListener(
      event,
      (message) => handle(JSON.parse(message.data)),
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
  outdated: () => void,
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

  let body = response.body
  if (
    response.ok &&
    /^[\t\n\r ]*text\/event-stream[\t\n\r ]*(?:;|$)/i.test(
      response.headers.get('content-type') ?? '',
    ) &&
    body
  ) {
    // Each fetch owns its own acceptance and deadline, including reconnects.
    let accepted = false
    const reject = () => {
      if (!init.signal?.aborted) {
        outdated()
      }
    }
    const deadline = setTimeout(reject, 10_000)
    const clear = () => clearTimeout(deadline)
    init.signal?.addEventListener('abort', clear, { once: true })
    const decoder = new TextDecoder()
    const parser = createParser({
      onEvent: (event) => {
        if (accepted) {
          return
        }
        try {
          const data: unknown = JSON.parse(event.data)
          if (
            event.event !== 'protocol' ||
            typeof data !== 'object' ||
            data === null ||
            !('version' in data) ||
            data.version !== 1
          ) {
            reject()
            return
          }
          accepted = true
          clear()
        } catch {
          reject()
        }
      },
    })
    const gate = new TransformStream<
      Uint8Array<ArrayBuffer>,
      Uint8Array<ArrayBuffer>
    >({
      transform(chunk, controller) {
        // Validate before EventSource can dispatch any complete state frame.
        if (!accepted) {
          parser.feed(decoder.decode(chunk, { stream: true }))
        }
        if (!init.signal?.aborted) {
          controller.enqueue(chunk)
        }
      },
      flush() {
        clear()
        if (!accepted) {
          reject()
        }
      },
    })
    void body
      .pipeTo(gate.writable, { signal: init.signal })
      .catch(() => {})
      .finally(() => {
        clear()
        init.signal?.removeEventListener('abort', clear)
      })
    body = gate.readable
  }

  // FetchLike needs only these fields. Preserve redirect metadata while the
  // platform pipe owns cancellation, even after EventSource locks its reader.
  return {
    url: response.url,
    status: response.status,
    redirected: response.redirected,
    headers: response.headers,
    body:
      body?.pipeThrough(new TransformStream(), {
        signal: init.signal,
      }) ?? null,
  }
}
