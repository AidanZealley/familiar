import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'

type PathOptions = {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  home?: string
  codeDir?: string
}

/** Resolve paths without creating or opening the owner's files. */
export function resolvePaths({
  env = process.env,
  platform = process.platform,
  home = homedir(),
  codeDir = import.meta.dirname,
}: PathOptions = {}) {
  const legacy = resolve(
    env.XDG_DATA_HOME ?? resolve(home, '.local/share'),
    'familiar',
  )
  const platformDefault =
    platform === 'darwin'
      ? resolve(home, 'Library/Application Support/Familiar')
      : platform === 'win32'
        ? resolve(
            env.LOCALAPPDATA ?? resolve(home, 'AppData/Local'),
            'Familiar',
          )
        : legacy

  // Earlier releases used the XDG location on every platform. Keep an
  // existing installation there rather than silently starting a new one.
  const dataDir = resolve(
    env.FAMILIAR_DATA_DIR ?? (existsSync(legacy) ? legacy : platformDefault),
  )
  return {
    dataDir,
    // Saved stdio MCP commands inherit this directory, including relative script paths.
    workDir:
      basename(codeDir) === 'src' ? resolve(codeDir, '../../..') : codeDir,
    cliPath: resolve(
      codeDir,
      basename(codeDir) === 'src' ? 'cli.ts' : 'familiar.js',
    ),
    webDir:
      basename(codeDir) === 'src'
        ? resolve(codeDir, '../../web/dist')
        : resolve(codeDir, 'web'),
  }
}

/** Both setup and the daemon create private storage through this boundary. */
export function ensureDataDir(dataDir: string) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  chmodSync(dataDir, 0o700)
}
