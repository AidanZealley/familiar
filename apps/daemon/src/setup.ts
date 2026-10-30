import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { ensureDataDir, resolvePaths } from './paths.ts'
import { openService } from './service/index.ts'
import { readSettings, saveSettings } from './settings.ts'
import { publish } from './tailnet.ts'

export async function setup() {
  const paths = resolvePaths()
  const service = openService(paths)
  if (process.env.FAMILIAR_HOST && process.env.FAMILIAR_HOST !== '127.0.0.1') {
    throw new Error(
      'Setup requires FAMILIAR_HOST=127.0.0.1. Remote access uses Tailscale.',
    )
  }
  const settings = readSettings(paths.dataDir)
  if (!existsSync(resolve(paths.dataDir, 'settings.json'))) {
    const terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    try {
      settings.name =
        (
          await terminal.question(`Assistant name [${settings.name}]: `)
        ).trim() || settings.name
    } finally {
      terminal.close()
    }
  }
  ensureDataDir(paths.dataDir)
  const changed = saveSettings(paths.dataDir, settings)
  console.log(changed ? 'Saved settings.' : 'Settings are already saved.')

  // Pi's presence check does not rotate tokens. Only the running daemon
  // refreshes them, so setup cannot race its in-memory credential store.
  const { openModels } = await import('./models.ts')
  if ((await openModels().checkAuth('openai'))?.type === 'oauth') {
    console.log(
      'ChatGPT login is already saved. Familiar refreshes it when needed.',
    )
  } else {
    const { signIn } = await import('./sign-in.ts')
    await service.withStopped(() => signIn())
  }
  service.install(changed)
  console.log(`Open Familiar: http://127.0.0.1:${settings.port}`)
  const url = publish(settings.port)
  if (url) {
    console.log(`On your tailnet: ${url}`)
  }
}
