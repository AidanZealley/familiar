import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { openFamiliar } from '@familiar/core'
import { config, dataPath } from './config.ts'
import { lockDataDir } from './lock.ts'
import { openModels } from './models.ts'
import { serveFamiliar } from './serve.ts'

lockDataDir(dataPath('daemon.lock'))

const familiar = await openFamiliar({
  storage: await openNodeSqliteStorage(dataPath('familiar.sqlite')),
  models: openModels(),
  model: config.model,
  name: config.name,
})

serveFamiliar(familiar, {
  host: config.host,
  port: config.port,
  owner: config.owner,
  webDir: config.webDir,
  label: config.name,
})
