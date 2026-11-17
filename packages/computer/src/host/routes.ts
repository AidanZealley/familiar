import type { FamiliarId, Workspace } from '@familiar-ai/core'
import { Hono, type Context } from 'hono'
import type { UpgradeWebSocket } from 'hono/ws'
import { socketTransport, type SocketTransport } from '../transport.ts'
import type { Computers } from './computers.ts'
import { originOf } from './logins.ts'
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
 * - `POST /:familiar` gives the Familiar a machine to pair, or pairs it
 *   afresh, and answers `{ link }`, the pairing link to run the agent with.
 *   With `{ "provider": true }` it gives the Familiar a computer the host's
 *   provider runs instead, and answers `{ status }`.
 * - `DELETE /:familiar` removes its computer, with the disk of one the
 *   provider ran.
 * - `GET /:familiar` answers `{ status, provided, provider }`: `status` is
 *   `none`, `asleep`, `offline` or `online`; `provided` is whether the
 *   provider runs the computer, not a paired machine; `provider` is whether
 *   this host has a provider to give one.
 * - `GET /:familiar/logins` answers its computer's logins as
 *   `[{ site, username }]`, never their passwords.
 * - `PUT /:familiar/logins` saves `{ site, username, password }` in place of
 *   any login for that site, answering `{ site }`, the exact origin it's for.
 * - `DELETE /:familiar/logins?site=…` deletes the login for that site.
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
    .get('/:familiar/logins', (c) => c.json(computers.logins.list(idOf(c))))
    .put('/:familiar/logins', async (c) => {
      const { site, username, password } = (await c.req
        .json()
        .catch(() => ({}))) as Record<string, unknown>
      if (
        typeof site !== 'string' ||
        typeof username !== 'string' ||
        typeof password !== 'string' ||
        !password
      ) {
        return c.json(
          { error: 'A login needs a site, username and password.' },
          400,
        )
      }
      try {
        const origin = originOf(site)
        computers.logins.set(idOf(c), origin, { username, password })
        return c.json({ site: origin })
      } catch (error) {
        return c.json({ error: (error as Error).message }, 400)
      }
    })
    .delete('/:familiar/logins', (c) => {
      computers.logins.delete(idOf(c), c.req.query('site') ?? '')
      return c.json({})
    })
    .get('/:familiar', async (c) =>
      c.json({
        status: await computers.status(idOf(c)),
        provided: computers.isProvided(idOf(c)),
        provider: computers.provides,
      }),
    )
    .delete('/:familiar', async (c) => {
      await computers.remove(idOf(c))
      return c.json({ status: await computers.status(idOf(c)) })
    })
    .post('/:familiar', async (c) => {
      const id = idOf(c)
      const familiar = workspace.familiars.get(id)
      if (!familiar) {
        return c.json({ error: 'not-found' }, 404)
      }
      const { provider } = (await c.req.json().catch(() => ({}))) as {
        provider?: boolean
      }
      if (provider && !computers.provides) {
        return c.json({ error: 'no-provider' }, 400)
      }
      if (provider) {
        await computers.provide(id)
      }
      const token = provider ? undefined : await computers.pair(id)
      // A Familiar with a computer uses its tools.
      const { plugins } = await familiar.capabilities()
      if (!plugins.includes(COMPUTER_PLUGIN)) {
        await familiar.setCapabilities({
          plugins: [...plugins, COMPUTER_PLUGIN],
        })
      }
      if (!token) {
        return c.json({ status: await computers.status(id) })
      }
      // Beside this route, wherever the host mounted it.
      const link = new URL('connect', c.req.url)
      link.hash = token
      return c.json({ link: link.href })
    })
}
