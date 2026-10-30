import { execFileSync } from 'node:child_process'
import { basename, dirname, resolve } from 'node:path'
import { resolvePaths } from './paths.ts'
import { openService } from './service/index.ts'
import { readSettings } from './settings.ts'
import { unpublish } from './tailnet.ts'

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
