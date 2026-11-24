import { Hono } from 'hono'
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
}

/** Updating this installation, as the routes need it. */
export type Updater = {
  info(): UpdateInfo
  available(): Promise<Partial<Record<UpdateSource, string>>>
  /** Runs `familiar update` from `source` as a job outside the service. */
  start(source: UpdateSource): void
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
  return {
    info: () => ({
      installed: installed
        ? { version: installed.version, source: installed.source }
        : null,
      service: isService(),
      last: lastUpdate(paths.dataDir) ?? null,
    }),
    available: availableVersions,
    start: (source) => openService(paths).runJob('update', updateArgs(source)),
  }
}

const isSource = (value: unknown): value is UpdateSource =>
  value === 'release' || value === 'main'

/**
 * Mounted at `/update`: `GET` the `UpdateInfo`, `GET /available` the
 * latest version of each source, and `POST { source }` to start one.
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
      const info = updater.info()
      if (!info.installed || !info.service) {
        return c.json({ error: 'This installation cannot update itself.' }, 400)
      }
      if (running(info.last)) {
        return c.json({ error: 'An update is already running.' }, 409)
      }
      try {
        updater.start(source)
      } catch (error) {
        return c.json(
          { error: error instanceof Error ? error.message : String(error) },
          500,
        )
      }
      return c.body(null, 202)
    })
