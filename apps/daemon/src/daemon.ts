import { createHash } from 'node:crypto'
import { mkdirSync, realpathSync } from 'node:fs'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { computer } from '@familiar-ai/computer'
import { dockerHost } from '@familiar-ai/computer/docker'
import { fileSecretStore, lockDataDir } from '@familiar-ai/core/node'
import { settingsComputerLimit } from './computer-limit.ts'
import { config, dataPath, deviceId } from './config.ts'
import { stdioTransport } from './mcp-stdio.ts'
import { ensureDataDir } from './paths.ts'
import { offeredModels, openModels } from './models.ts'
import { WEB_RENDERING } from './rendering.ts'
import { loadPlugins } from './plugins.ts'
import { openPush } from './push.ts'
import { OWNER_ID, serveWorkspace } from './serve.ts'
import { webPlugin } from './web/plugin.ts'
import { openDaemonWorkspace } from './workspace.ts'

export async function serve() {
  ensureDataDir(config.dataDir)
  lockDataDir(dataPath('daemon.lock'))
  // Created so the owner can find where their own plugins and portraits go.
  mkdirSync(config.pluginsDir, { recursive: true })
  mkdirSync(config.avatarsDir, { recursive: true })

  const push = openPush({ path: dataPath, contact: config.pushContact })

  const models = openModels()
  const computerLimit = settingsComputerLimit(config.dataDir)
  // Computers for the Familiars given one, where Docker is installed.
  const computers = dockerHost({
    hostId: computerHostId(),
    maxComputers: computerLimit.get,
  })
  const { modelChoices, chatModel } = await offeredModels(models)
  const { workspace } = await openDaemonWorkspace(
    {
      storage: await openNodeSqliteStorage(dataPath('familiar.sqlite')),
      models,
      chatModel,
      modelChoices,
      // The machine's zone, so the owner's calendar is the one their clock shows.
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      hostInstructions: WEB_RENDERING,
      // Owners sign in to ChatGPT from the web UI, through the Models requests
      // use, while it's the default; a key provider needs no sign-in.
      ...(chatModel.provider === 'openai' && {
        account: { login: { getDeviceId: deviceId, agentName: config.name } },
      }),
      notify: push.notify,
      plugins: await loadPlugins(config.pluginsDir, [
        webPlugin,
        computer({ host: computers }),
      ]),
      // What Familiars call the owner, until they choose another name.
      people: [{ id: OWNER_ID, name: config.owner }],
      // Web search and pages are useful to any Familiar; others opt in.
      defaultCapabilities: { plugins: [webPlugin.name] },
      secrets: fileSecretStore(dataPath('secrets.json'), dataPath('vault.key')),
      mcpFetch: fetch,
      mcpStdio: stdioTransport,
    },
    config.name,
  )

  serveWorkspace(workspace, {
    host: config.host,
    port: config.port,
    owner: config.owner,
    webDir: config.webDir,
    avatarsDir: config.avatarsDir,
    label: config.name,
    push: push.host,
    models,
    computerLimit,
    computers,
  })
}

/**
 * This installation's ID on a Docker engine, which removes any computer
 * under it that its Familiars don't have. It comes from the data
 * directory's device ID and real path, so neither a copy of the directory
 * (a development daemon's, say) nor another machine's installation at the
 * same path on a shared engine gets the same one. The trade-off: moving
 * the data directory changes it, so its Familiars start on new, empty
 * computers, and the old ones and their disks stay on the engine under the
 * old ID until removed with `docker`.
 */
function computerHostId() {
  return createHash('sha256')
    .update(`${deviceId()}\0${realpathSync(config.dataDir)}`)
    .digest('hex')
    .slice(0, 12)
}
