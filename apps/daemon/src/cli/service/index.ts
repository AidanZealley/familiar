import { linuxService } from './linux.ts'

export function openService(options: Parameters<typeof linuxService>[0]) {
  if (process.platform !== 'linux') {
    throw new Error(
      'Automatic service setup currently supports Linux only. Use familiar sign-in and familiar serve on this platform.',
    )
  }
  return linuxService(options)
}
