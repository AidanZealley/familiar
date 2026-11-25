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
import { setTimeout } from 'node:timers/promises'
import { lockHeld, takeLock } from '@familiar-ai/core/node'
import { resolvePaths } from '../paths.ts'
import { runNpm } from './npm.ts'
import { readSettings } from '../settings.ts'
import type { UpdateInfo } from '../updates.ts'
import { openService } from './service/index.ts'

/** Where an update fetches the package from. */
export type UpdateSource = 'release' | 'main'

const releases = 'https://github.com/AidanZealley/familiar/releases'

/**
 * The version `source` offers. Each source's `version.json` is a pointer the
 * publish workflow moves only once the build it names is published, and a
 * published build never changes, so the two can't disagree.
 */
async function latestVersion(source: UpdateSource) {
  const response = await fetch(
    source === 'release'
      ? `${releases}/latest/download/version.json`
      : `${releases}/download/main-build/version.json`,
    { signal: AbortSignal.timeout(10000) },
  )
  if (!response.ok) {
    await response.body?.cancel()
    return undefined
  }
  return ((await response.json()) as { version: string }).version
}

/** A published build's package. Each build is its own `v<version>` release. */
const packageUrl = (version: string) =>
  `${releases}/download/v${version}/familiar.tgz`

const packageVersion = (dir: string) =>
  (
    JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as {
      version: string
    }
  ).version

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
  const version = packageVersion(dir)
  const source: UpdateSource = version.includes('-main.') ? 'main' : 'release'
  return { dir, version, source }
}

export const describeSource = (source: UpdateSource) =>
  source === 'main' ? 'the latest build of main' : 'the latest release'

/** How far an update got. `update()` is its only writer. */
export type UpdateRecord = {
  source: UpdateSource
  from: string
  /** The version installed beside the running one, once it is. */
  to?: string
  /**
   * `installing` happens beside the running version; only `restarting`
   * stops the service. A new version that doesn't answer is rolled back
   * within `restarting`, and the update ends `failed`, saying so.
   */
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
 * An update's package folders, all beside the live one in its
 * `node_modules`, so moving between them is a rename on one filesystem.
 * npm ignores dot-named folders there.
 */
const packageFolders = (live: string) => {
  const modules = dirname(live)
  const staging = resolve(modules, `.${basename(live)}-next`)
  return {
    /** The package the service and the `familiar` command run. */
    live,
    /** A global npm prefix the new version is installed into. */
    staging,
    /** The new version in it, laid out as in the real prefix. */
    staged: resolve(
      staging,
      process.platform === 'win32' ? 'node_modules' : 'lib/node_modules',
      basename(live),
    ),
    /** The old version, while the new one proves it starts. */
    previous: resolve(modules, `.${basename(live)}-previous`),
  }
}

/**
 * Installs the package from `source`, by default the one this installation
 * came from, and restarts the service with it. The terminal and the web
 * app's update (which runs this as its own job, outside the service) both
 * come here; the lock lets one run at a time, and the record says how far
 * it got.
 *
 * The new version is downloaded and installed beside the live one while
 * Familiar keeps running, so a network or npm failure never stops it. Only
 * then is the service stopped, the new version swapped in by renaming
 * folders, and the service started. If the new version doesn't answer, the
 * same swap puts the old one back. Both folders are removed at the end.
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
  const folders = packageFolders(installed.dir)
  const lock = takeLock(files.lock)
  if (!lock.taken) {
    throw new Error(
      `An update is already running${lock.holder ? ` (process ${lock.holder})` : ''}.`,
    )
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
  const clear = () => {
    rmSync(files.package, { force: true })
    rmSync(folders.staging, { recursive: true, force: true })
    rmSync(folders.previous, { recursive: true, force: true })
  }
  write({})
  // An update that died part way may have left them.
  clear()
  const log = openSync(files.log, 'w', 0o600)
  console.log(
    `Updating Familiar ${installed.version} from ${describeSource(from)}.`,
  )
  try {
    const version = await latestVersion(from)
    if (!version) {
      throw new Error(`Couldn't find ${describeSource(from)}.`)
    }
    await fetchTo(packageUrl(version), files.package)
    write({ phase: 'installing' })
    runNpm(
      ['install', '--global', '--prefix', folders.staging, files.package],
      { stdio: ['ignore', log, log] },
    )
    write({ phase: 'restarting', to: packageVersion(folders.staged) })
    await activate(paths, folders, installed.version, record.to!)
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
    clear()
    // Last, after the record's final phase.
    lock.release()
  }
}

/**
 * Puts the staged version live and leaves a registered service running
 * it, or, if it doesn't answer with its version, running the previous one
 * again. Throws unless the new version answered. Ctrl-C or a closed
 * terminal waits for this to finish, so it never leaves Familiar stopped.
 *
 * From the first swap, this process's own package is at `previous`, so
 * everything it runs must already be loaded: no lazy imports.
 */
async function activate(
  paths: ReturnType<typeof resolvePaths>,
  folders: ReturnType<typeof packageFolders>,
  from: string,
  to: string,
) {
  const service = openService(paths)
  const registered = service.isRegistered()
  const port = readSettings(paths.dataDir).port
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
  const wait = () =>
    console.log('Finishing the update, so Familiar is left running.')
  for (const signal of signals) {
    process.on(signal, wait)
  }
  try {
    if (!registered) {
      swap(folders.live, folders.staged, folders.previous)
      return
    }
    service.stop()
    try {
      swap(folders.live, folders.staged, folders.previous)
    } catch (error) {
      service.start()
      throw error
    }
    // Registered afresh, which starts it, so a registration from an older
    // version, such as one without the data folder as its working
    // directory, doesn't outlive the update.
    service.install()
    if (await answers(port, to)) {
      return
    }
    service.stop()
    swap(folders.live, folders.previous, folders.staged)
    service.start()
    throw new Error(
      (await answers(port, from))
        ? `${to} didn't answer after starting, so Familiar went back to ${from}.`
        : `${to} didn't answer after starting, and ${from} didn't either once it was put back. Run familiar logs to see why.`,
    )
  } finally {
    for (const signal of signals) {
      process.off(signal, wait)
    }
  }
}

/**
 * Puts the package at `incoming` live, moving the live one to `outgoing`,
 * or, if that fails, leaves both where they were.
 */
function swap(live: string, incoming: string, outgoing: string) {
  renameSync(live, outgoing)
  try {
    renameSync(incoming, live)
  } catch (error) {
    renameSync(outgoing, live)
    throw error
  }
}

/**
 * Whether the daemon on `port` comes to answer as `version`, within about
 * 30 seconds: long enough for the service manager to start it, or restart
 * it once after a crash. Asking for its version means an answer from the
 * one it replaced can't count.
 */
async function answers(port: number, version: string) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/update`, {
        signal: AbortSignal.timeout(1000),
      })
      if (!response.ok) {
        await response.body?.cancel()
      } else if (
        ((await response.json()) as UpdateInfo).installed?.version === version
      ) {
        return true
      }
    } catch {
      // Not listening yet.
    }
    await setTimeout(250)
  }
  return false
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
  const running = lockHeld(files.lock)
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

/** The latest version each source offers. */
export async function availableVersions() {
  const [release, main] = await Promise.all([
    latestVersion('release'),
    latestVersion('main'),
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
