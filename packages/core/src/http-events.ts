import type {
  ConversationWatch,
  DocumentWatch,
} from '@earendil-works/pi-durable'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { AccountApi } from './account/index.ts'
import type { Documents, DocumentName, StreamEvent } from './http.ts'

/** Only supplied sources are opened and sent. Null account explicitly sends null. */
export type EventSources = {
  conversation?: () => Promise<ConversationWatch>
  memory?: () => Promise<DocumentWatch<Documents['memory']>>
  episodes?: () => Promise<DocumentWatch<Documents['episodes']>>
  schedules?: () => Promise<DocumentWatch<Documents['schedules']>>
  account?: Pick<AccountApi, 'state' | 'onChange'> | null
}

/** Mount at `/`; account-only and empty streams stay open until disconnected. */
export const eventRoutes = (sources: EventSources) =>
  new Hono().get('/events', (c) =>
    streamSSE(c, async (stream) => {
      const watches: { stop(): Promise<unknown>; closed: Promise<unknown> }[] =
        []
      let stopped = false
      let stopAccount: (() => void) | undefined
      let heartbeat: ReturnType<typeof setInterval> | undefined
      let disconnected!: () => void
      const aborted = new Promise<void>((resolve) => {
        disconnected = resolve
      })
      const stop = () => {
        stopped = true
        disconnected()
        stopAccount?.()
        stopAccount = undefined
        clearInterval(heartbeat)
        for (const watch of watches.splice(0)) {
          void watch.stop()
        }
      }
      stream.onAbort(stop)
      const send = (message: StreamEvent) =>
        stream.writeSSE({
          event: message.event,
          data: JSON.stringify(message.data),
        })
      const retain = (watch: (typeof watches)[number]) => {
        if (stopped) {
          void watch.stop()
          return false
        }
        watches.push(watch)
        return true
      }
      const document = async <Name extends DocumentName>(
        name: Name,
        open: () => Promise<DocumentWatch<Documents[Name]>>,
      ) => {
        const watch = await open()
        if (!retain(watch)) {
          return
        }
        // The generic name and value belong to the same union member.
        await send({
          event: 'document',
          data: { name, value: watch.value },
        } as StreamEvent)
        if (!stopped) {
          watch.start((_value, ops) =>
            send({ event: 'document.ops', data: { name, ops } }),
          )
        }
      }
      try {
        await send({ event: 'protocol', data: { version: 1 } })
        if (sources.conversation && !stopped) {
          const watch = await sources.conversation()
          if (retain(watch)) {
            await send({ event: 'view', data: watch.value })
            if (!stopped) {
              watch.start((_value, ops) => send({ event: 'ops', data: ops }))
            }
          }
        }
        for (const name of ['memory', 'episodes', 'schedules'] as const) {
          const open = sources[name]
          if (open && !stopped) {
            await document(name, open)
          }
        }
        if (sources.account !== undefined && !stopped) {
          await send({
            event: 'account',
            data: sources.account?.state() ?? null,
          })
          if (!stopped) {
            stopAccount = sources.account?.onChange(
              (state) => void send({ event: 'account', data: state }),
            )
          }
        }
        if (!stopped) {
          heartbeat = setInterval(() => void stream.write(': ping\n\n'), 15_000)
          await Promise.race([aborted, ...watches.map((watch) => watch.closed)])
        }
      } finally {
        stop()
      }
    }),
  )
