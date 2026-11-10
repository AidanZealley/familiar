import type { ConversationWatch, WatchHandle } from '@earendil-works/pi-durable'
import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import {
  allows,
  forbidden,
  type AccessEnv,
  type Operation,
  type Resource,
} from '../access.ts'
import {
  PROTOCOL_VERSION,
  type Documents,
  type DocumentName,
  type StreamEvent,
} from './contract.ts'

type Watch = { stop(): Promise<unknown>; closed: Promise<unknown> }

/** What a source sends with, for as long as the stream lasts. */
export type Stream = {
  send(message: StreamEvent): Promise<void>
  /** Streams a document whole, then as each commit's changes. */
  document<Name extends DocumentName>(
    name: Name,
    open: () => Promise<WatchHandle<Readonly<Documents[Name]> | null>>,
  ): Promise<void>
  /** Streams a conversation's view whole, then as each commit's changes. */
  view(open: () => Promise<ConversationWatch>): Promise<void>
  /** Runs `cleanup` when the stream ends, or now if it already has. */
  onEnd(cleanup: () => void): void
}

/** One thing a stream can carry, sent only if `allow` agrees to `operation`. */
export type Source = {
  operation: Operation
  open(stream: Stream): Promise<void>
}

/**
 * A server-sent stream of every source the author is allowed, each asked
 * once as the stream connects, so revoking access later doesn't close a
 * stream that's already open. A stream every source refuses answers 403;
 * then `check` can throw, such as a 404 for a resource that doesn't exist.
 * Each value arrives whole first, then as each commit's changes.
 */
export async function streamEvents(
  c: Context<AccessEnv>,
  sources: readonly Source[],
  resource?: Resource,
  check?: () => unknown,
) {
  const allowed: Source[] = []
  for (const source of sources) {
    if (await allows(c, source.operation, resource)) {
      allowed.push(source)
    }
  }
  if (!allowed.length) {
    return forbidden(c)
  }
  await check?.()

  return streamSSE(c, async (sse) => {
    // Owns the stream's lifetime: the client leaving, or any watch closing,
    // ends it, and everything opened registers its cleanup here.
    const done = new AbortController()
    const { signal } = done
    const end = () => done.abort()
    sse.onAbort(end)

    const send = (message: StreamEvent) =>
      sse.writeSSE({
        event: message.event,
        data: JSON.stringify(message.data),
      })

    const onEnd = (cleanup: () => void) =>
      signal.aborted
        ? cleanup()
        : signal.addEventListener('abort', cleanup, { once: true })

    // Keeps `watch` until the stream ends. Returns whether it still runs.
    const keep = (watch: Watch) => {
      void watch.closed.then(end, end)
      onEnd(() => void watch.stop())
      return !signal.aborted
    }

    const stream: Stream = {
      send,
      onEnd,
      document: async (name, open) => {
        const watch = await open()
        if (!keep(watch)) {
          return
        }
        // The generic name and value belong to the same union member.
        await send({
          event: 'document',
          data: { name, value: watch.value },
        } as StreamEvent)
        if (!signal.aborted) {
          watch.start((_value, ops) =>
            send({ event: 'document.ops', data: { name, ops } }),
          )
        }
      },
      view: async (open) => {
        const watch = await open()
        if (!keep(watch)) {
          return
        }
        await send({ event: 'view', data: watch.value })
        if (!signal.aborted) {
          watch.start((_value, ops) => send({ event: 'ops', data: ops }))
        }
      },
    }

    const setup = async () => {
      await send({ event: 'protocol', data: { version: PROTOCOL_VERSION } })
      for (const source of allowed) {
        if (!signal.aborted) {
          await source.open(stream)
        }
      }
      const heartbeat = setInterval(() => void sse.write(': ping\n\n'), 15_000)
      onEnd(() => clearInterval(heartbeat))
    }

    const ended = new Promise<void>((resolve) => onEnd(resolve))
    try {
      await Promise.race([setup().then(() => ended), ended])
    } finally {
      end()
    }
  })
}
