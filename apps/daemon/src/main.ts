import { existsSync } from 'node:fs'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { openFamiliar } from '@familiar/core'
import { createHttpApi } from '@familiar/core/http'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { config, dataPath } from './config.ts'
import { lockDataDir } from './lock.ts'
import { openModels } from './models.ts'

lockDataDir(dataPath('daemon.lock'))

const familiar = await openFamiliar({
  storage: await openNodeSqliteStorage(dataPath('familiar.sqlite')),
  models: openModels(),
  model: config.model,
  name: config.name,
})

const app = new Hono().route(
  '/api',
  createHttpApi(familiar, { authenticate: () => config.owner }),
)

// The built web UI, when there is one. In development Vite serves it instead.
if (existsSync(config.webDir)) {
  app.use(serveStatic({ root: config.webDir }))
  app.get('*', serveStatic({ root: config.webDir, path: 'index.html' }))
}

const server = serve(
  { fetch: app.fetch, hostname: config.host, port: config.port },
  () => console.log(`Familiar on http://${config.host}:${config.port}`),
)

const shutdown = () => {
  server.close()
  void familiar.close().then(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
