import { readFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { ensureDataDir, resolvePaths } from '../paths.ts'
import { openService } from './service/index.ts'
import { readSettings, saveSettings } from '../settings.ts'
import { runNpm } from './npm.ts'
import { publishedUrl, unpublish } from './tailnet.ts'

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

/** Where `familiar update` fetches the package from. */
export type UpdateSource = 'release' | 'main'

const packageUrls: Record<UpdateSource, string> = {
  release:
    'https://github.com/AidanZealley/familiar/releases/latest/download/familiar.tgz',
  // The rolling prerelease the publish workflow replaces on each push to main.
  main: 'https://github.com/AidanZealley/familiar/releases/download/main-build/familiar.tgz',
}

/**
 * The installed package, or undefined for a source checkout. Where it came
 * from is read from its version, never stored: a build of `main` is
 * versioned `<last release>-main.<commit>`.
 */
function installedPackage(cliPath: string) {
  const dir = dirname(cliPath)
  if (
    basename(cliPath) !== 'familiar.js' ||
    basename(dirname(dir)) !== 'node_modules'
  ) {
    return undefined
  }
  const { version } = JSON.parse(
    readFileSync(resolve(dir, 'package.json'), 'utf8'),
  ) as { version: string }
  const source: UpdateSource = version.includes('-main.') ? 'main' : 'release'
  return { dir, version, source }
}

const describeSource = (source: UpdateSource) =>
  source === 'main' ? 'the latest build of main' : 'the latest release'

/**
 * Installs the package from `source`, by default the one this installation
 * came from, and restarts the service.
 */
export async function update(source?: UpdateSource) {
  const paths = resolvePaths()
  const installed = installedPackage(paths.cliPath)
  if (!installed) {
    throw new Error(
      'This is a source checkout. Update it with git and pnpm service:install.',
    )
  }
  const from = source ?? installed.source
  const service = openService(paths)
  // npm's default prefix can differ from the one the installer used. Update
  // the actual installation, not a second global copy elsewhere on PATH.
  const prefix = resolve(
    installed.dir,
    process.platform === 'win32' ? '../..' : '../../..',
  )
  console.log(
    `Updating Familiar ${installed.version} from ${describeSource(from)}.`,
  )
  await service.withStopped(async () => {
    runNpm(['install', '--global', '--prefix', prefix, packageUrls[from]], {
      stdio: 'inherit',
    })
  })
  console.log(
    `Updated Familiar to ${installedPackage(paths.cliPath)?.version}.`,
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
