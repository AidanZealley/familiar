import { Hono, type Context } from 'hono'
import { openService } from './cli/service/index.ts'
import {
  availableVersions,
  installedPackage,
  lastUpdate,
  updateArgs,
  type LastUpdate,
  type UpdateSource,
} from './cli/update.ts'
import { resolvePaths } from './paths.ts'

/** What the web app shows about updating this installation. */
export type UpdateInfo = {
  /** The package this daemon runs, or null for a source checkout. */
  installed: { version: string; source: UpdateSource } | null
  /** Whether this daemon is the service, which an update restarts. */
  service: boolean
  /** The current or last update, wherever it was started. */
  last: LastUpdate | null
  /** When this daemon started, so a client can tell it has restarted. */
  started: string
}

/** Updating this installation, as the routes need it. */
export type Updater = {
  info(): UpdateInfo
  available(): Promise<Partial<Record<UpdateSource, string>>>
  /** Runs `familiar update` from `source` as a job outside the service. */
  start(source: UpdateSource): void
  /** Runs `familiar restart` as a job outside the service it restarts. */
  restart(): void
}

const running = (last: LastUpdate | null) =>
  last !== null &&
  ['downloading', 'installing', 'restarting'].includes(last.phase)

/**
 * This installation's updater. The version is read once: it's the one this
 * process runs, whatever an update has put on disk since.
 */
export function installationUpdater(): Updater {
  const paths = resolvePaths()
  const installed = installedPackage(paths.cliPath)
  const started = new Date().toISOString()
  // Only one daemon runs per data folder, so if its service is running,
  // this is it. Read once, when first asked: it can't change.
  let service: boolean | undefined
  const isService = () => {
    try {
      service ??= installed !== undefined && openService(paths).isRunning()
    } catch {
      // No service on this platform.
      service = false
    }
    return service
  }
  // The installation's one maintenance job: update and restart share its
  // name, so the service manager refuses one while the other runs, from the
  // moment it's accepted, before it writes any record.
  const maintain = (args: string[]) =>
    openService(paths).runJob('maintenance', args)
  return {
    info: () => ({
      installed: installed
        ? { version: installed.version, source: installed.source }
        : null,
      service: isService(),
      last: lastUpdate(paths.dataDir) ?? null,
      started,
    }),
    available: availableVersions,
    start: (source) => maintain(updateArgs(source)),
    restart: () => maintain(['restart']),
  }
}

const isSource = (value: unknown): value is UpdateSource =>
  value === 'release' || value === 'main'

/**
 * Starts `job` to `action` this installation, answering 202, unless this
 * daemon isn't the installed service or an update is already running.
 */
function startJob(
  c: Context,
  info: UpdateInfo,
  action: 'update' | 'restart',
  job: () => void,
) {
  if (!info.installed || !info.service) {
    return c.json({ error: `This installation cannot ${action} itself.` }, 400)
  }
  if (running(info.last)) {
    return c.json({ error: 'An update is already running.' }, 409)
  }
  try {
    job()
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    )
  }
  // The daemon accepting it, which the job may stop before this reaches the
  // client, so it can tell when a later one answers.
  return c.json({ started: info.started }, 202)
}

/**
 * Mounted at `/update`: `GET` the `UpdateInfo`, `GET /available` the
 * latest version of each source, `POST { source }` to start one, and
 * `POST /restart` to restart the service. Both need this daemon to be the
 * installed service, and refuse while an update runs.
 */
export const updateRoutes = (updater: Updater) =>
  new Hono()
    .get('/', (c) => c.json(updater.info()))
    .get('/available', async (c) => {
      try {
        return c.json(await updater.available())
      } catch (error) {
        return c.json(
          { error: error instanceof Error ? error.message : String(error) },
          503,
        )
      }
    })
    .post('/', async (c) => {
      const { source } = await c.req
        .json<{ source?: unknown }>()
        .catch(() => ({ source: undefined }))
      if (!isSource(source)) {
        return c.json({ error: 'source must be release or main' }, 400)
      }
      return startJob(c, updater.info(), 'update', () => updater.start(source))
    })
    .post('/restart', (c) =>
      startJob(c, updater.info(), 'restart', updater.restart),
    )
