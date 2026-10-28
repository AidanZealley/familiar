import { existsSync } from 'node:fs'
import { isIP } from 'node:net'
import type { Familiar } from '@familiar/core'
import { createHttpApi, type PushHost } from '@familiar/core/http'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'

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

/** Serve one Familiar over HTTP until SIGINT or SIGTERM, then close it. */
export function serveFamiliar(familiar: Familiar, options: ServeOptions) {
  const app = new Hono().route(
    '/api',
    createHttpApi(familiar, {
      authenticate: (request) =>
        isAllowedHost(request.headers.get('host')) ? options.owner : undefined,
      push: options.push,
    }),
  )

  // In development Vite serves the UI instead.
  if (options.webDir && existsSync(options.webDir)) {
    app.use(serveStatic({ root: options.webDir }))
    app.get('*', serveStatic({ root: options.webDir, path: 'index.html' }))
  }

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
