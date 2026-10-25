import { existsSync } from 'node:fs'
import type { Familiar } from '@familiar/core'
import { createHttpApi } from '@familiar/core/http'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'

export type ServeOptions = {
  host: string
  port: number
  /** The author recorded for every request. The network is the auth. */
  owner: string
  /** The built web UI, served when it exists. */
  webDir?: string
  label: string
}

/** Serve one Familiar over HTTP until SIGINT or SIGTERM, then close it. */
export function serveFamiliar(familiar: Familiar, options: ServeOptions) {
  const app = new Hono().route(
    '/api',
    createHttpApi(familiar, { authenticate: () => options.owner }),
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
    void familiar.close().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
