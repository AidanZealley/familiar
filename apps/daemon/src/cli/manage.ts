import { createInterface } from 'node:readline/promises'
import { ensureDataDir, resolvePaths } from '../paths.ts'
import { openService } from './service/index.ts'
import { readSettings, saveSettings } from '../settings.ts'
import { publishedUrl, unpublish } from './tailnet.ts'
import { describeSource, installedPackage } from './update.ts'

export function logs() {
  openService(resolvePaths()).logs()
}

export function uninstall() {
  const paths = resolvePaths()
  const settings = readSettings(paths.dataDir)
  openService(paths).uninstall()
  unpublish(settings.port)
  console.log(
    `Removed the Familiar service. Your data remains in ${paths.dataDir}.`,
  )
}

export async function signIn() {
  const login = await import('./sign-in.ts')
  if (['linux', 'darwin', 'win32'].includes(process.platform)) {
    await openService(resolvePaths()).withStopped(() => login.signIn())
  } else {
    await login.signIn()
  }
}

export function restart() {
  openService(resolvePaths()).restart()
  console.log('Restarted Familiar.')
}

export function status() {
  const paths = resolvePaths()
  const settings = readSettings(paths.dataDir, {})
  const running = openService(paths).isRunning()
  const installed = installedPackage(paths.cliPath)
  console.log(`Name: ${settings.name}`)
  console.log(
    installed
      ? `Version: ${installed.version}, updates from ${describeSource(installed.source)}`
      : 'Version: source checkout',
  )
  console.log(`Service: ${running ? 'running' : 'stopped'}`)
  console.log(`Local: http://127.0.0.1:${settings.port}`)
  console.log(`Plugins: ${paths.pluginsDir}`)
  console.log(`Portraits: ${paths.avatarsDir}`)
  const url = publishedUrl(settings.port)
  if (url) {
    console.log(`Tailnet: ${url}`)
  }
}

export async function rename(newName?: string) {
  const paths = resolvePaths()
  // Rename only the saved name; unrelated environment overrides are per run.
  const settings = readSettings(paths.dataDir, {})
  if (newName === undefined) {
    const terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    try {
      newName =
        (await terminal.question(`New name [${settings.name}]: `)).trim() ||
        settings.name
    } finally {
      terminal.close()
    }
  }
  const name = newName.trim()
  if (!name) {
    throw new Error('The name must not be empty.')
  }
  if (name === settings.name) {
    console.log(`The name is already ${name}.`)
    return
  }
  const service = openService(paths)
  const running = service.isRunning()
  ensureDataDir(paths.dataDir)
  saveSettings(paths.dataDir, { ...settings.explicit, name })
  if (running) {
    service.restart()
  }
  console.log(`Renamed ${settings.name} to ${name}.`)
}
