import type { DocumentWatch } from '@earendil-works/pi-durable'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { Familiar } from '../familiar.ts'
import { allows, forbidden, type AccessEnv } from './access.ts'
import type { Documents, DocumentName, StreamEvent } from './contract.ts'

type Watch = { stop(): Promise<unknown>; closed: Promise<unknown> }

const SOURCES = [
  'conversation',
  'memory',
  'episodes',
  'schedules',
  'account',
] as const

/**
 * `/events`: a server-sent stream of every source the author is allowed,
 * each asked once as the stream connects, so revoking access later doesn't
 * close a stream that's already open. A stream every source refuses answers
 * 403. Each value arrives whole first, then as each commit's changes.
 */
export const eventRoutes = (familiar: Familiar) =>
  new Hono<AccessEnv>().get('/events', async (c) => {
    const allowed = new Set<(typeof SOURCES)[number]>()
    for (const source of SOURCES) {
      if (await allows(c, `events.${source}`)) {
        allowed.add(source)
      }
    }
    if (!allowed.size) {
      return forbidden(c)
    }

    return streamSSE(c, async (stream) => {
      // Owns the stream's lifetime: the client leaving, or any watch closing,
      // ends it, and everything opened registers its cleanup here.
      const done = new AbortController()
      const { signal } = done
      const end = () => done.abort()
      stream.onAbort(end)

      const send = (message: StreamEvent) =>
        stream.writeSSE({
          event: message.event,
          data: JSON.stringify(message.data),
        })

      // Runs `cleanup` when the stream ends, or now if it already has.
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

      const document = async <Name extends DocumentName>(
        name: Name,
        open: () => Promise<DocumentWatch<Documents[Name]>>,
      ) => {
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
      }

      const setup = async () => {
        await send({ event: 'protocol', data: { version: 2 } })
        if (allowed.has('conversation') && !signal.aborted) {
          const watch = await familiar.watch()
          if (keep(watch)) {
            await send({ event: 'view', data: watch.value })
            if (!signal.aborted) {
              watch.start((_value, ops) => send({ event: 'ops', data: ops }))
            }
          }
        }
        const documents = {
          memory: familiar.memory.watch,
          episodes: familiar.memory.watchEpisodes,
          schedules: familiar.schedules.watch,
        }
        for (const name of ['memory', 'episodes', 'schedules'] as const) {
          if (allowed.has(name) && !signal.aborted) {
            await document(name, documents[name])
          }
        }
        if (allowed.has('account') && !signal.aborted) {
          // Null once when the host manages credentials itself.
          const account = familiar.account
          await send({ event: 'account', data: account?.state() ?? null })
          if (account) {
            onEnd(
              account.onChange(
                (state) => void send({ event: 'account', data: state }),
              ),
            )
          }
        }
        const heartbeat = setInterval(
          () => void stream.write(': ping\n\n'),
          15_000,
        )
        onEnd(() => clearInterval(heartbeat))
      }

      const ended = new Promise<void>((resolve) => onEnd(resolve))
      try {
        await Promise.race([setup().then(() => ended), ended])
      } finally {
        end()
      }
    })
  })
