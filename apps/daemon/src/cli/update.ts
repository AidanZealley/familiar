import {
  closeSync,
  createWriteStream,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { lockHolder, takeLock } from '@familiar-ai/core/node'
import { resolvePaths } from '../paths.ts'
import { runNpm } from './npm.ts'
import { openService } from './service/index.ts'

/** Where an update fetches the package from. */
export type UpdateSource = 'release' | 'main'

const download = (source: UpdateSource, file: string) =>
  source === 'release'
    ? `https://github.com/AidanZealley/familiar/releases/latest/download/${file}`
    : // The rolling prerelease the publish workflow replaces on each push to main.
      `https://github.com/AidanZealley/familiar/releases/download/main-build/${file}`

/**
 * The installed package, or undefined for a source checkout. Where it came
 * from is read from its version, never stored: a build of `main` is
 * versioned `<last release>-main.<commit>`.
 */
export function installedPackage(cliPath: string) {
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

export const describeSource = (source: UpdateSource) =>
  source === 'main' ? 'the latest build of main' : 'the latest release'

/** How far an update got. `update()` is its only writer. */
export type UpdateRecord = {
  source: UpdateSource
  from: string
  /** The version installed, once it is. */
  to?: string
  phase: 'downloading' | 'installing' | 'restarting' | 'done' | 'failed'
  error?: string
  startedAt: string
  endedAt?: string
}

/** An update's files in the data folder. */
const updateFiles = (dataDir: string) => ({
  /** Held by the running update's process: at most one at a time. */
  lock: resolve(dataDir, 'update.lock'),
  /** The current or last update's `UpdateRecord`. */
  record: resolve(dataDir, 'update.json'),
  /** npm's output for the current or last update. */
  log: resolve(dataDir, 'update.log'),
  /** The downloaded package, until it's installed. */
  package: resolve(dataDir, 'update.tgz'),
})

/**
 * Installs the package from `source`, by default the one this installation
 * came from, and restarts the service. The download comes first, so a
 * network failure never stops Familiar. The terminal and the web app's
 * update (which runs this as its own job, outside the service) both come
 * here; the lock lets one run at a time, and the record says how far it got.
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
  const files = updateFiles(paths.dataDir)
  const lock = takeLock(files.lock)
  if (!lock.taken) {
    throw new Error(`An update is already running (process ${lock.holder}).`)
  }
  const record: UpdateRecord = {
    source: from,
    from: installed.version,
    phase: 'downloading',
    startedAt: new Date().toISOString(),
  }
  const write = (change: Partial<UpdateRecord>) => {
    Object.assign(record, change)
    // Whole or not at all: the daemon reads it at any moment.
    writeFileSync(`${files.record}.tmp`, JSON.stringify(record), {
      mode: 0o600,
    })
    renameSync(`${files.record}.tmp`, files.record)
  }
  write({})
  const log = openSync(files.log, 'w', 0o600)
  console.log(
    `Updating Familiar ${installed.version} from ${describeSource(from)}.`,
  )
  try {
    await fetchTo(download(from, 'familiar.tgz'), files.package)
    // npm's default prefix can differ from the one the installer used.
    // Update the actual installation, not a second global copy elsewhere.
    const prefix = resolve(
      installed.dir,
      process.platform === 'win32' ? '../..' : '../../..',
    )
    await openService(paths).withStopped(async () => {
      write({ phase: 'installing' })
      runNpm(['install', '--global', '--prefix', prefix, files.package], {
        stdio: ['ignore', log, log],
      })
      write({
        phase: 'restarting',
        to: installedPackage(paths.cliPath)?.version,
      })
    })
    write({ phase: 'done', endedAt: new Date().toISOString() })
    console.log(`Updated Familiar to ${record.to}.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    write({
      phase: 'failed',
      error: message,
      endedAt: new Date().toISOString(),
    })
    throw new Error(`${message} The update's log is in ${files.log}.`, {
      cause: error,
    })
  } finally {
    closeSync(log)
    rmSync(files.package, { force: true })
    // Last, after the record's final phase.
    lock.release()
  }
}

async function fetchTo(url: string, file: string) {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Couldn't download ${url} (${response.status}).`)
  }
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(file, { mode: 0o600 }),
  )
}

/**
 * The current or last update, as the web app shows it. One that stopped
 * part way, its process gone, reads as `interrupted`; that is never stored.
 * The log's end comes with a failure.
 */
export type LastUpdate = Omit<UpdateRecord, 'phase'> & {
  phase: UpdateRecord['phase'] | 'interrupted'
  log?: string
}

export function lastUpdate(dataDir: string): LastUpdate | undefined {
  const files = updateFiles(dataDir)
  // The lock before the record: an update writes its last phase before it
  // lets go, so a held lock and an unfinished record mean it's still running.
  const running = lockHolder(files.lock) !== undefined
  const record = readJson<UpdateRecord>(files.record)
  if (!record) {
    return undefined
  }
  const final = record.phase === 'done' || record.phase === 'failed'
  const phase = final || running ? record.phase : 'interrupted'
  return phase === 'failed' || phase === 'interrupted'
    ? { ...record, phase, log: tail(files.log, 40) }
    : { ...record, phase }
}

/** The latest version each source offers, from the file beside its package. */
export async function availableVersions() {
  const versionOf = async (source: UpdateSource) => {
    const response = await fetch(download(source, 'version.json'), {
      signal: AbortSignal.timeout(10000),
    })
    // A release from before the file existed has none.
    return response.ok
      ? ((await response.json()) as { version: string }).version
      : undefined
  }
  const [release, main] = await Promise.all([
    versionOf('release'),
    versionOf('main'),
  ])
  return { release, main }
}

function readJson<T>(file: string) {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

function tail(file: string, lines: number) {
  try {
    return readFileSync(file, 'utf8')
      .trimEnd()
      .split('\n')
      .slice(-lines)
      .join('\n')
  } catch {
    return undefined
  }
}

/** The CLI an update job runs, for `update` with this source. */
export const updateArgs = (source: UpdateSource) => ['update', `--${source}`]
