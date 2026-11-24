import type { SpawnSyncOptionsWithStringEncoding } from 'node:child_process'
import spawn from 'cross-spawn'

/** npm is a .cmd launcher on Windows; cross-spawn owns its quoting and lookup. */
export function runNpm(
  args: string[],
  options: Pick<
    SpawnSyncOptionsWithStringEncoding,
    'cwd' | 'stdio' | 'env'
  > = {},
) {
  const result = spawn.sync('npm', args, { ...options, encoding: 'utf8' })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    // Its output went elsewhere when stdio wasn't piped.
    const stderr = result.stderr?.trim()
    throw new Error(
      `npm failed (${result.status ?? result.signal})${stderr ? `: ${stderr}` : '.'}`,
    )
  }
  return result.stdout ?? ''
}
