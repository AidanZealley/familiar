import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { summonFamiliar } from '@familiar/core'
import { config, dataPath } from './config.ts'
import { lockDataDir } from './lock.ts'
import { openModels } from './models.ts'
import { openPush } from './push.ts'
import { serveFamiliar } from './serve.ts'

lockDataDir(dataPath('daemon.lock'))

const push = openPush({ path: dataPath, contact: config.pushContact })

const familiar = await summonFamiliar({
  storage: await openNodeSqliteStorage(dataPath('familiar.sqlite')),
  models: openModels(),
  model: config.model,
  name: config.name,
  notify: push.notify,
})

serveFamiliar(familiar, {
  host: config.host,
  port: config.port,
  owner: config.owner,
  webDir: config.webDir,
  label: config.name,
  push: push.host,
})
