import { execFileSync } from 'node:child_process'
import { basename, dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { ensureDataDir, resolvePaths } from './paths.ts'
import { openService } from './service/index.ts'
import { readSettings, saveSettings } from './settings.ts'
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

export async function update() {
  const paths = resolvePaths()
  const packageDir = dirname(paths.cliPath)
  if (
    basename(paths.cliPath) !== 'familiar.js' ||
    basename(dirname(packageDir)) !== 'node_modules'
  ) {
    throw new Error(
      'This is a source checkout. Update it with git and pnpm service:install.',
    )
  }
  const service = openService(paths)
  // npm's default prefix can differ from the one the installer used. Update
  // the actual installation, not a second global copy elsewhere on PATH.
  const prefix = resolve(
    packageDir,
    process.platform === 'win32' ? '../..' : '../../..',
  )
  await service.withStopped(async () => {
    execFileSync(
      'npm',
      [
        'install',
        '--global',
        '--prefix',
        prefix,
        'https://github.com/AidanZealley/familiar/releases/latest/download/familiar.tgz',
      ],
      { stdio: 'inherit' },
    )
  })
  console.log('Updated Familiar.')
}

export async function signIn() {
  const login = await import('./sign-in.ts')
  if (process.platform === 'linux') {
    await openService(resolvePaths()).withStopped(() => login.signIn())
  } else {
    await login.signIn()
  }
}

export function status() {
  const paths = resolvePaths()
  const settings = readSettings(paths.dataDir, {})
  const running = openService(paths).isRunning()
  console.log(`Name: ${settings.name}`)
  console.log(`Service: ${running ? 'running' : 'stopped'}`)
  console.log(`Local: http://127.0.0.1:${settings.port}`)
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
