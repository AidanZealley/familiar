import { mkdirSync } from 'node:fs'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { fileSecretStore, lockDataDir } from '@familiar-ai/core/node'
import { config, dataPath, deviceId } from './config.ts'
import { stdioTransport } from './mcp-stdio.ts'
import { ensureDataDir } from './paths.ts'
import { openModels } from './models.ts'
import { WEB_RENDERING } from './rendering.ts'
import { loadPlugins } from './plugins.ts'
import { openPush } from './push.ts'
import { OWNER_ID, serveWorkspace } from './serve.ts'
import { webPlugin } from './web/plugin.ts'
import { openDaemonWorkspace } from './workspace.ts'

export async function serve() {
  ensureDataDir(config.dataDir)
  lockDataDir(dataPath('daemon.lock'))
  // Created so the owner can find where their own plugins go.
  mkdirSync(config.pluginsDir, { recursive: true })

  const push = openPush({ path: dataPath, contact: config.pushContact })

  const models = openModels()
  const { workspace } = await openDaemonWorkspace(
    {
      storage: await openNodeSqliteStorage(dataPath('familiar.sqlite')),
      models,
      model: config.model,
      chatModels: config.chatModels,
      // The machine's zone, so the owner's calendar is the one their clock shows.
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      hostInstructions: WEB_RENDERING,
      // Owners sign in to ChatGPT from the web UI, through the Models requests use.
      account: { login: { getDeviceId: deviceId, agentName: config.name } },
      notify: push.notify,
      plugins: await loadPlugins(config.pluginsDir, [webPlugin]),
      // What Familiars call the owner, until they choose another name.
      people: [{ id: OWNER_ID, name: config.owner }],
      // Web search and pages are useful to any Familiar; others opt in.
      defaultCapabilities: { plugins: [webPlugin.name] },
      secrets: fileSecretStore(dataPath('secrets.json')),
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
    label: config.name,
    push: push.host,
  })
}
