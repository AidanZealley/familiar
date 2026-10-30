import { linuxService } from './linux.ts'
import { macosService } from './macos.ts'
import { windowsService } from './windows.ts'
import type { ServiceOptions } from './types.ts'

export function openService(options: ServiceOptions) {
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
