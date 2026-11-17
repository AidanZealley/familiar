import type { FamiliarId, Workspace } from '@familiar-ai/core'
import { Hono, type Context } from 'hono'
import type { UpgradeWebSocket } from 'hono/ws'
import { socketTransport, type SocketTransport } from '../transport.ts'
import type { Computers } from './computers.ts'
import { COMPUTER_PLUGIN } from './plugin.ts'

export type ComputerRoutesOptions = {
  workspace: Workspace
  /** The runtime's WebSocket upgrade, such as @hono/node-server's. */
  upgradeWebSocket: UpgradeWebSocket
}

const idOf = (c: Context) => Number(c.req.param('familiar')) as FamiliarId

/**
 * Pairing for the owner, and where computers connect. Mount it where only
 * the owner reaches the pairing routes; `/connect` checks its own token.
 *
 * - `POST /:familiar` gives the Familiar a computer, or pairs it afresh, and
 *   answers `{ link }`, the pairing link to run the agent with.
 * - `GET /:familiar` answers `{ status }`: `none`, `offline` or `online`.
 * - `GET /connect` is the agent's WebSocket, with its token as a bearer.
 */
export function computerRoutes(
  computers: Computers,
  { workspace, upgradeWebSocket }: ComputerRoutesOptions,
) {
  return new Hono<{ Variables: { familiar: FamiliarId; token: string } }>()
    .get(
      '/connect',
      async (c, next) => {
        const token = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1]
        const familiar = token && computers.familiarFor(token)
        if (!familiar) {
          return c.json({ error: 'unpaired' }, 401)
        }
        c.set('familiar', familiar)
        c.set('token', token)
        await next()
      },
      upgradeWebSocket((c) => {
        let transport: SocketTransport | undefined
        return {
          onOpen: (_event, socket) => {
            transport = socketTransport({
              send: (data) => socket.send(data),
              close: () => socket.close(),
            })
            computers
              .connect(c.get('familiar'), c.get('token'), transport)
              .catch(() => socket.close())
          },
          onMessage: (event) => transport?.receive(String(event.data)),
          onClose: () => transport?.ended(),
        }
      }),
    )
    .get('/:familiar', (c) => c.json({ status: computers.status(idOf(c)) }))
    .post('/:familiar', async (c) => {
      const id = idOf(c)
      const familiar = workspace.familiars.get(id)
      if (!familiar) {
        return c.json({ error: 'not-found' }, 404)
      }
      const token = computers.pair(id)
      // A Familiar with a computer uses its tools.
      const { plugins } = await familiar.capabilities()
      if (!plugins.includes(COMPUTER_PLUGIN)) {
        await familiar.setCapabilities({
          plugins: [...plugins, COMPUTER_PLUGIN],
        })
      }
      // Beside this route, wherever the host mounted it.
      const link = new URL('connect', c.req.url)
      link.hash = token
      return c.json({ link: link.href })
    })
}
