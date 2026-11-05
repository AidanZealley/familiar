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
