import type { Context } from 'hono'
import { defineWebSocketHelper, type UpgradeWebSocket } from 'hono/ws'

/** Where `createHttpApi` leaves the host's `upgradeWebSocket` for this. */
export const RUNTIME_UPGRADE = 'familiar.upgradeWebSocket'

/** Whether a request asks to become a WebSocket. */
export const isWebSocketUpgrade = (c: Context) =>
  c.req.header('upgrade')?.toLowerCase() === 'websocket'

/**
 * Hono's `upgradeWebSocket`, for a plugin's routes, on whichever runtime the
 * host serves from: `.get('/echo', upgradeWebSocket(() => ({ onMessage:
 * (event, ws) => ws.send(event.data as string) })))`. A host that gave
 * `createHttpApi` none answers 501. Hono builds the events for every request
 * to the route, so open what a socket needs in `onOpen`, not before.
 */
export const upgradeWebSocket = defineWebSocketHelper((c, events, options) => {
  if (!isWebSocketUpgrade(c)) {
    return
  }
  const runtime = c.get(RUNTIME_UPGRADE) as UpgradeWebSocket | undefined
  if (!runtime) {
    return c.json({ error: 'This server has no WebSockets.' }, 501)
  }
  return runtime(c, events, options)
})
