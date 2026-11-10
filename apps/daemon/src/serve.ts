import { existsSync } from 'node:fs'
import { isIP } from 'node:net'
import type { Workspace } from '@familiar-ai/core'
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
function isAllowedHost(host: string | null) {
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
function browserRequestsSameOrigin(): MiddlewareHandler {
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
 * The daemon's own UI is never shown inside another page, which could
 * otherwise overlay it to trick the owner into clicking. Only the daemon's
 * UI: hosts embedding Familiar serve their own pages with their own policy.
 * `X-Frame-Options` is for browsers older than `frame-ancestors`.
 */
const unframed: MiddlewareHandler = async (c, next) => {
  await next()
  c.header('Content-Security-Policy', "frame-ancestors 'none'")
  c.header('X-Frame-Options', 'DENY')
}

/** The one author the daemon records, whatever the owner is called. */
export const OWNER_ID = 'owner'

/**
 * The daemon's routes: the whole API under `/api`, since everyone who can
 * reach it is the owner, then the built web UI.
 */
export function daemonApp(
  workspace: Workspace,
  options: Pick<ServeOptions, 'owner' | 'webDir' | 'push'>,
) {
  const app = new Hono().use(browserRequestsSameOrigin()).route(
    '/api',
    createHttpApi(workspace, {
      authenticate: (request) =>
        isAllowedHost(request.headers.get('host'))
          ? { id: OWNER_ID, name: options.owner }
          : undefined,
      // Everyone who can reach the daemon is its owner.
      allow: () => true,
      push: options.push,
    }),
  )

  // In development Vite serves the UI instead.
  if (options.webDir && existsSync(options.webDir)) {
    app.use(unframed)
    app.use(serveStatic({ root: options.webDir }))
    app.get('*', serveStatic({ root: options.webDir, path: 'index.html' }))
  }
  return app
}

/** Serve a workspace over HTTP until SIGINT or SIGTERM, then close it. */
export function serveWorkspace(workspace: Workspace, options: ServeOptions) {
  const app = daemonApp(workspace, options)

  const server = serve(
    { fetch: app.fetch, hostname: options.host, port: options.port },
    () =>
      console.log(`${options.label} on http://${options.host}:${options.port}`),
  )

  const shutdown = () => {
    server.close()
    void workspace.dismiss().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
