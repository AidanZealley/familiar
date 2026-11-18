import {
  definePlugin,
  defineTool,
  familiar,
  upgradeWebSocket,
  type PluginEnv,
} from '@familiar-ai/core'
import type { ImageContent, TextContent } from '@familiar-ai/core/extensions'
import { Hono } from 'hono'
import { z } from 'zod'
import type { ComputerHost } from './host.ts'
import { shorten } from './shorten.ts'
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
  return definePlugin({
    name: 'computer',
    title: 'Computer',
    tools: Object.entries(computerTools).map(([name, tool]) =>
      defineTool({
        name,
        description: tool.description,
        parameters: z.toJSONSchema(tool.input) as object,
        // Only looking is safe to run again after a restart; Pi reports any
        // other call a restart interrupted, so the model looks before retrying.
        ...('reads' in tool && { replay: 'safe' as const }),
        annotations: annotationsOf(tool),
        execute: async (args, api, context) => {
          const id = await familiar(context).familiarId()
          let result
          try {
            result = await host.call(
              id,
              name,
              args as Record<string, unknown>,
              context.abortSignal,
              // The chat shows it, as "Waiting for you to hand back".
              () =>
                void api.details({ waiting: true }, context).catch(() => {}),
            )
          } catch (error) {
            // Stopped, or the host is closing: Pi reports that itself.
            if (context.abortSignal?.aborted) {
              throw error
            }
            const reason =
              error instanceof Error ? error.message : String(error)
            return {
              output: [
                {
                  type: 'text' as const,
                  text: `Your computer stopped answering during this call (${reason}), so it may have partly run. Look before trying again.`,
                },
              ],
              isError: true,
            }
          }
          const keep = 'keepsEnd' in tool ? 'end' : 'start'
          return {
            output: result.content.flatMap<TextContent | ImageContent>(
              (block) =>
                block.type === 'text'
                  ? [{ type: 'text', text: shorten(block.text, keep) }]
                  : block.type === 'image'
                    ? [
                        {
                          type: 'image',
                          data: block.data,
                          mimeType: block.mimeType,
                        },
                      ]
                    : [],
            ),
            isError: result.isError ?? false,
          }
        },
      }),
    ),
    open: ({ watchFamiliars }) => {
      watchFamiliars((familiars) =>
        host.sync(familiars).catch((error) => {
          console.error(
            `Computers couldn't sync: ${error instanceof Error ? error.message : error}`,
          )
        }),
      )
      return () => host.close()
    },
    routes: new Hono<PluginEnv>()
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
          // Control lasts as long as this: aborted when the socket closes or
          // goes silent, whichever is first.
          const person = new AbortController()
          let heard = Date.now()
          let pings: ReturnType<typeof setInterval> | undefined
          return {
            onOpen: async (_event, ws) => {
              const end = (code: number, reason: string) => {
                person.abort()
                ws.close(code, reasonFor(reason))
              }
              pings = setInterval(() => {
                if (Date.now() - heard > SILENT_MS) {
                  end(4001, 'The connection was lost.')
                } else {
                  ws.send(CONTROL_PROTOCOL.ping)
                }
              }, PING_MS)
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
            onMessage: () => {
              heard = Date.now()
            },
            onClose: () => {
              clearInterval(pings)
              person.abort()
            },
          }
        }),
      ),
  })
}
