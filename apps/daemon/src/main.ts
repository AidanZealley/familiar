import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { summonFamiliar } from '@familiar/core'
import { config, dataPath, deviceId } from './config.ts'
import { guardedFetch } from './fetch.ts'
import { stdioTransport } from './mcp-stdio.ts'
import { lockDataDir } from './lock.ts'
import { openModels } from './models.ts'
import { loadPlugins } from './plugins.ts'
import { openPush } from './push.ts'
import { fileSecretStore } from './secrets.ts'
import { serveFamiliar } from './serve.ts'

lockDataDir(dataPath('daemon.lock'))

const push = openPush({ path: dataPath, contact: config.pushContact })

const familiar = await summonFamiliar({
  storage: await openNodeSqliteStorage(dataPath('familiar.sqlite')),
  models: openModels(),
  model: config.model,
  chatModels: config.chatModels,
  name: config.name,
  deviceId,
  notify: push.notify,
  plugins: await loadPlugins(),
  secrets: fileSecretStore(dataPath('secrets.json')),
  fetch: guardedFetch,
  mcpFetch: fetch,
  mcpStdio: stdioTransport,
})

serveFamiliar(familiar, {
  host: config.host,
  port: config.port,
  owner: config.owner,
  webDir: config.webDir,
  label: config.name,
  push: push.host,
})
