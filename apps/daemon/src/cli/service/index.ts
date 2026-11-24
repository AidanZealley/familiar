import { setTimeout } from 'node:timers/promises'
import { linuxService } from './linux.ts'
import { macosService } from './macos.ts'
import { windowsService } from './windows.ts'
import type { ServiceOptions } from './types.ts'

type PlatformService = ReturnType<typeof linuxService>

/**
 * Runs `work` with the daemon stopped, so it can't race it, such as for its
 * credentials, and starts it again afterwards, even if `work` fails. A
 * service that wasn't running is left stopped.
 */
export async function withStopped<T>(
  service: Pick<PlatformService, 'isRunning' | 'stop' | 'start'>,
  work: () => Promise<T>,
) {
  const running = service.isRunning()
  if (running) {
    service.stop()
  }
  try {
    return await work()
  } finally {
    if (running) {
      service.start()
    }
  }
}

/** This platform's service for the installation at `options.dataDir`. */
export function openService(options: ServiceOptions) {
  const service = platformService(options)
  return {
    ...service,
    withStopped: <T>(work: () => Promise<T>) => withStopped(service, work),
  }
}

function platformService(options: ServiceOptions): PlatformService {
  switch (process.platform) {
    case 'linux':
      return linuxService(options)
    case 'darwin':
      return macosService(options)
    case 'win32':
      return windowsService(options)
    default:
      throw new Error(
        'Automatic service setup supports Linux, macOS and Windows. Use familiar sign-in and familiar serve on this platform.',
      )
  }
}

/**
 * Waits for the service's daemon to answer on `port`, as it does once it
 * has opened its HTTP listener after starting. Throws if it doesn't within
 * about five seconds.
 */
export async function waitForService(port: number) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/connections`, {
        signal: AbortSignal.timeout(500),
      })
      await response.body?.cancel()
      if (response.ok) {
        return
      }
    } catch {
      // systemd starts Node before the daemon has opened its HTTP listener.
    }
    await setTimeout(250)
  }
  throw new Error(
    'Familiar did not answer after starting. Run familiar logs to inspect the service.',
  )
}
