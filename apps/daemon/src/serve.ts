import { existsSync } from 'node:fs'
import { isIP } from 'node:net'
import type { Familiar } from '@familiar-ai/core'
import { createHttpApi, type PushHost } from '@familiar-ai/core/http'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type MiddlewareHandler } from 'hono'
import { csrf } from 'hono/csrf'

export type ServeOptions = {
  host: string
  port: number
  /**
   * The author recorded for every request. The network is the auth, so
   * requests must also arrive by an address the owner uses (`isAllowedHost`).
   */
  owner: string
  /** The built web UI, served when it exists. */
  webDir?: string
  label: string
  push?: PushHost
}

/**
 * Whether a request's Host is one the owner reaches the daemon by: an IP
 * address, localhost, or a tailnet name, as Vite's dev server allows. A web
 * page on any other name may have rebound its DNS to this machine to reach
 * the API as if it were its own origin; Tailscale owns *.ts.net, so those
 * names can't be rebound.
 */
export function isAllowedHost(host: string | null) {
  if (!host || !URL.canParse(`http://${host}`)) {
    return false
  }
  const name = new URL(`http://${host}`).hostname
  return (
    name === 'localhost' ||
    name.endsWith('.ts.net') ||
    isIP(name.replace(/^\[|\]$/g, '')) !== 0
  )
}

/** Whether `origin` names the server this request was addressed to. */
const sameHost = (origin: string, host: string | undefined) =>
  URL.canParse(origin) && new URL(origin).host === host

/**
 * The network is the daemon's auth, so a page on another site could make the
 * owner's browser post to it. Hono's csrf refuses browser mutations unless
 * they are same-origin by Sec-Fetch-Site or by an Origin naming the Host they
 * were sent to. Comparing hosts rather than whole origins accepts the
 * daemon's own page through a proxy that keeps the Host and changes the
 * scheme, such as Tailscale Serve's HTTPS, and Vite's proxy in development.
 * Hono checks the content types a form can send, and treats a missing one as
 * text/plain, so bodyless POSTs are checked too; JSON from another site needs
 * a CORS preflight the daemon never grants.
 *
 * A request with neither header doesn't come from a browser, which always
 * sends Origin on a cross-origin POST, so the CLI, curl and scripts on the
 * owner's network keep working without one.
 */
export function browserRequestsSameOrigin(): MiddlewareHandler {
  const guard = csrf({
    origin: (origin, c) => sameHost(origin, c.req.header('host')),
  })
  return (c, next) =>
    c.req.header('origin') === undefined &&
    c.req.header('sec-fetch-site') === undefined
      ? next()
      : guard(c, next)
}

/**
 * The daemon's routes: the whole API under `/api`, since everyone who can
 * reach it is the owner, then the built web UI.
 */
export function daemonApp(
  familiar: Familiar,
  options: Pick<ServeOptions, 'owner' | 'webDir' | 'push'>,
) {
  const app = new Hono().use(browserRequestsSameOrigin()).route(
    '/api',
    createHttpApi(familiar, {
      routes: true,
      authenticate: (request) =>
        isAllowedHost(request.headers.get('host'))
          ? { id: 'owner', name: options.owner }
          : undefined,
      push: options.push,
    }),
  )

  // In development Vite serves the UI instead.
  if (options.webDir && existsSync(options.webDir)) {
    app.use(serveStatic({ root: options.webDir }))
    app.get('*', serveStatic({ root: options.webDir, path: 'index.html' }))
  }
  return app
}

/** Serve one Familiar over HTTP until SIGINT or SIGTERM, then close it. */
export function serveFamiliar(familiar: Familiar, options: ServeOptions) {
  const app = daemonApp(familiar, options)

  const server = serve(
    { fetch: app.fetch, hostname: options.host, port: options.port },
    () =>
      console.log(`${options.label} on http://${options.host}:${options.port}`),
  )

  const shutdown = () => {
    server.close()
    void familiar.dismiss().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
