import { chmodSync, mkdirSync } from 'node:fs'
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
  const dataDir = resolve(
    env.FAMILIAR_DATA_DIR ??
      (platform === 'darwin'
        ? resolve(home, 'Library/Application Support/Familiar')
        : platform === 'win32'
          ? resolve(
              env.LOCALAPPDATA ?? resolve(home, 'AppData/Local'),
              'Familiar',
            )
          : resolve(
              env.XDG_DATA_HOME ?? resolve(home, '.local/share'),
              'familiar',
            )),
  )
  // Run from a checkout's `apps/daemon/src`, or from the installed bundle.
  const source = basename(codeDir) === 'src'
  return {
    dataDir,
    /** The owner's own plugins, each a file the daemon loads at start. */
    pluginsDir: resolve(dataDir, 'plugins'),
    /** The owner's portraits for their Familiars, which the web UI offers. */
    avatarsDir: resolve(dataDir, 'avatars'),
    // Saved stdio MCP commands inherit this directory, including relative script paths.
    workDir: source ? resolve(codeDir, '../../..') : codeDir,
    cliPath: resolve(codeDir, source ? 'cli.ts' : 'familiar.js'),
    webDir: resolve(codeDir, source ? '../../web/dist' : 'web'),
  }
}

/**
 * Create the data directory, private to this user even if it already
 * existed: it holds the ChatGPT login and the whole conversation.
 */
export function ensureDataDir(dataDir: string) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  // Windows ignores mode bits. The default location inherits the user profile's
  // permissions, and rewriting them can need privileges a normal user lacks.
  chmodSync(dataDir, 0o700)
}
