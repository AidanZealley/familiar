import {
  definePlugin,
  defineTool,
  upgradeWebSocket,
  type PluginEnv,
} from '@familiar-ai/core'
import { Hono } from 'hono'
import { z } from 'zod'
import type { ComputerHost } from './host.ts'
import { callComputer } from './call.ts'
import { loginTools } from './login-tools.ts'
import { computerLogins, LOGINS } from './logins.ts'
import { annotationsOf, computerTools } from './tools.ts'

/**
 * `GET /control`, a person taking over a Familiar's computer: it wakes the
 * computer, and once they have control the server sends `held`. They have
 * it until the socket closes, which hands it back at once. The server sends
 * `ping` every `PING_MS`; any message back counts as alive, and a socket
 * silent for `SILENT_MS` is taken as gone (a dropped phone, say) and hands
 * back. Refused (someone else has control), couldn't start, or ended by the
 * computer stopping: the server closes the socket with why.
 */
export const CONTROL_PROTOCOL = { held: 'held', ping: 'ping' } as const
const PING_MS = 5000
const SILENT_MS = 15_000
/** `text` as a WebSocket close reason, which is at most 123 bytes. */
const reasonFor = (text: string) => {
  const bytes = new TextEncoder()
  let reason = text
  while (bytes.encode(reason).length > 123) {
    reason = `${reason.slice(0, -2)}…`
  }
  return reason
}

export type ComputerOptions = {
  /**
   * Where the computers run, such as `dockerHost()`. The plugin owns it, so
   * give each workspace its own: it's closed when the workspace closes.
   */
  host: ComputerHost
}

/**
 * Computers for Familiars: a Familiar with this plugin turned on (its
 * `computer` capability) has one, and one without has none. Each tool call
 * goes to the calling Familiar's own computer, never another's. The host
 * hears who has one when the workspace opens and whenever that changes,
 * and removes the rest, disk included. On the plugin's routes, `GET /status`
 * is a Familiar's `ComputerStatus`, cheap to poll, and `GET /inspect` its
 * `ComputerDetail`, for a person looking at it. `GET /screen` is a
 * WebSocket of its screen's VNC (RFB) bytes, for a viewer such as noVNC:
 * closed at once if the computer isn't running, and when it stops.
 * `GET /control` is a WebSocket a person holds to take the computer over:
 * see `CONTROL_PROTOCOL`.
 */
export function computer({ host }: ComputerOptions) {
  const logins = computerLogins()
  return definePlugin({
    name: 'computer',
    title: 'Computer',
    tools: [
      ...Object.entries(computerTools).map(([name, tool]) =>
        defineTool({
          name,
          description: tool.description,
          parameters: z.toJSONSchema(tool.input) as object,
          // Only looking is safe to run again after a restart; Pi reports any
          // other call a restart interrupted, so the model looks before retrying.
          ...('reads' in tool && { replay: 'safe' as const }),
          annotations: annotationsOf(tool),
          execute: (args, api, context) =>
            callComputer(
              host,
              name,
              args as Record<string, unknown>,
              api,
              context,
              'keepsEnd' in tool ? 'end' : 'start',
            ),
        }),
      ),
      ...loginTools(host, logins),
    ],
    familiarSecrets: [LOGINS],
    open: (context) => {
      logins.open(context)
      context.watchFamiliars((familiars) =>
        host.sync(familiars).catch((error) => {
          console.error(
            `Computers couldn't sync: ${error instanceof Error ? error.message : error}`,
          )
        }),
      )
      return () => host.close()
    },
    routes: new Hono<PluginEnv>()
      .route('/logins', logins.routes)
      .get('/status', async (c) => c.json(await host.status(c.get('familiar'))))
      .get('/inspect', async (c) =>
        c.json(await host.inspect(c.get('familiar'))),
      )
      .get(
        '/screen',
        upgradeWebSocket((c) => {
          const id = c.get('familiar')
          // The socket owns the stream: it ends when the socket closes.
          const viewer = new AbortController()
          let writer:
            WritableStreamDefaultWriter<Uint8Array<ArrayBuffer>> | undefined
          return {
            onOpen: async (_event, ws) => {
              // Not running, or no telling (Docker failing, the socket gone).
              const screen = await host
                .screen(id, viewer.signal)
                .catch(() => undefined)
              if (!screen) {
                return ws.close(1000, "The computer isn't running.")
              }
              // The viewer speaks only after the display has, so nothing it
              // sends arrives before this.
              writer = screen.writable.getWriter()
              writer.closed.catch(() => {})
              try {
                for await (const bytes of screen.readable) {
                  ws.send(bytes)
                }
              } catch {
                // The exec failed: the screen has gone, as below.
              }
              ws.close(1000, 'The computer stopped.')
            },
            onMessage: (event) => {
              if (event.data instanceof ArrayBuffer) {
                writer?.write(new Uint8Array(event.data)).catch(() => {})
              }
            },
            onClose: () => viewer.abort(),
          }
        }),
      )
      .get(
        '/control',
        upgradeWebSocket((c) => {
          const id = c.get('familiar')
          // Control lasts as long as this: aborted, with the timers stopped,
          // when the socket closes or goes silent, whichever is first.
          const person = new AbortController()
          let pings: ReturnType<typeof setInterval> | undefined
          let silence: ReturnType<typeof setTimeout> | undefined
          const stop = () => {
            clearInterval(pings)
            clearTimeout(silence)
            person.abort()
          }
          /** Ends control and closes the socket with why; set once open. */
          let end: (code: number, reason: string) => void = stop
          /** Anything from the browser puts off the silence deadline. */
          const heard = () => {
            // Nothing re-arms it once control has ended.
            if (person.signal.aborted) {
              return
            }
            clearTimeout(silence)
            silence = setTimeout(
              () => end(4001, 'The connection was lost.'),
              SILENT_MS,
            )
          }
          return {
            onOpen: async (_event, ws) => {
              end = (code, reason) => {
                stop()
                ws.close(code, reasonFor(reason))
              }
              heard()
              pings = setInterval(() => ws.send(CONTROL_PROTOCOL.ping), PING_MS)
              let ended
              try {
                ;({ ended } = await host.control(id, person.signal))
              } catch (error) {
                return end(
                  4000,
                  error instanceof Error ? error.message : String(error),
                )
              }
              if (person.signal.aborted) {
                return
              }
              ws.send(CONTROL_PROTOCOL.held)
              await ended
              end(1000, 'Control ended.')
            },
            onMessage: heard,
            onClose: stop,
          }
        }),
      ),
  })
}
