import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { openWorkspace } from '@familiar-ai/core'
import { createHttpApi } from '@familiar-ai/core/http'
import { createModels } from '@familiar-ai/core/models'
import { openrouterProvider } from '@familiar-ai/core/models/openrouter'
import { fileSecretStore, lockDataDir } from '@familiar-ai/core/node'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { allow } from './access.ts'
import { authenticate, authRoutes } from './auth.ts'
import { config } from './config.ts'
import { github } from './plugins/github.ts'

// Everything Familiar keeps: its storage, and secrets the owner sets.
const data = (name: string) => resolve(config.dataDir, name)
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
lockDataDir(data('familiar.lock'))

// Pi reads OPENROUTER_API_KEY from the environment.
const models = createModels()
models.setProvider(openrouterProvider())
const model = { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5.5' }

const workspace = await openWorkspace({
  storage: await openNodeSqliteStorage(data('familiar.sqlite')),
  models,
  model,
  chatModels: [{ model, thinkingLevel: 'medium' }],
  timeZone: config.timeZone,
  plugins: [github],
  secrets: fileSecretStore(data('secrets.json')),
  // No `fetch`: on Node, tools get one that refuses private addresses.
  notify: async (notification) => console.log('Notification:', notification),
})
// One Familiar, made on the first run; the owner talks to it in their DM.
if (!(await workspace.familiars.list()).length) {
  await workspace.familiars.create({ name: config.name })
}

const app = new Hono()
  // The session is a cookie, which browsers send to this server from any
  // site, so refuse cross-site requests before anything reads them.
  .use(csrf())
  .route('/auth', authRoutes)
  .route('/api', createHttpApi(workspace, { authenticate, allow }))
  // The built UI; in development, Vite serves it instead.
  .use(serveStatic({ root: 'dist/web' }))

const server = serve({ fetch: app.fetch, port: config.port }, () =>
  console.log(`${config.name} on http://localhost:${config.port}`),
)

const shutdown = () => {
  server.close()
  void workspace.dismiss().then(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
