import type { ConversationView, EntryRecord } from '@earendil-works/pi-durable'

export const entry = (id: number) =>
  ({ id, conversationId: 1, kind: 'pi.system' }) as unknown as EntryRecord

export const view = (...ids: number[]) =>
  ({
    conversation: {},
    entries: ids.map(entry),
    docs: {},
  }) as unknown as ConversationView

/** One server-sent event, as the server writes it. */
export const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

/**
 * A stand-in server behind a fetch function. Each `/events` request gets a
 * real streamed Response that the test writes to with `send`, and that
 * aborting the request ends, as the network would. Other requests go to
 * `answer`. Relative URLs resolve against `http://familiar.test`.
 */
export function testServer(
  answer: (request: Request) => Response | Promise<Response> = () =>
    new Response(null, { status: 204 }),
  handshake = true,
) {
  const requests: Request[] = []
  const streams: ReadableStreamDefaultController<Uint8Array>[] = []
  let refuse: number | undefined
  let cancellations = 0

  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    const request = new Request(new URL(url, 'http://familiar.test'), init)
    requests.push(request)

    if (!request.url.endsWith('/events')) {
      return answer(request)
    }

    if (refuse !== undefined) {
      return Response.json({ error: 'refused' }, { status: refuse })
    }

    const body = new ReadableStream<Uint8Array>({
      cancel: () => {
        cancellations += 1
      },
      start: (controller) => {
        streams.push(controller)
        if (handshake) {
          controller.enqueue(
            new TextEncoder().encode(frame('protocol', { version: 1 })),
          )
        }
        request.signal.addEventListener('abort', () =>
          controller.error(request.signal.reason),
        )
      },
    })

    return new Response(body, {
      headers: { 'content-type': 'text/event-stream' },
    })
  }

  return {
    fetch,
    requests,
    cancellations: () => cancellations,
    /** How many times the event stream has been requested. */
    connections: () =>
      requests.filter((request) => request.url.endsWith('/events')).length,
    /** Writes to the newest stream: frames, or raw bytes in any split. */
    send: (chunk: string | Uint8Array) =>
      streams
        .at(-1)!
        .enqueue(
          typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk,
        ),
    /** Ends the newest stream cleanly. */
    end: () => streams.at(-1)!.close(),
    /** Drops the newest stream, as a network failure would. */
    drop: () => streams.at(-1)!.error(new TypeError('network error')),
    /** Answers later stream requests with this status, or streams again. */
    refuse: (status: number | undefined) => {
      refuse = status
    },
  }
}

export const tick = (ms = 30) =>
  new Promise((resolve) => setTimeout(resolve, ms))
