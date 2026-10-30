import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ensureDataDir, resolvePaths } from './paths.ts'
import { readSettings } from './settings.ts'

const paths = resolvePaths()

export const config = {
  ...paths,
  ...readSettings(paths.dataDir),
  host: process.env.FAMILIAR_HOST ?? '127.0.0.1',
  /** Sent to push services so they can contact the installation's owner. */
  pushContact:
    process.env.FAMILIAR_PUSH_CONTACT ?? 'mailto:familiar@example.com',
}

// Private to this user even if the directory already existed. Holds the
// ChatGPT login and the whole conversation.
ensureDataDir(config.dataDir)

export const dataPath = (name: string) => resolve(config.dataDir, name)

/** This installation's stable ID; OpenAI identifies the app's logins by it. */
export function deviceId() {
  const path = dataPath('device-id')
  if (!existsSync(path)) {
    writeFileSync(path, randomUUID(), { mode: 0o600 })
  }
  return readFileSync(path, 'utf8').trim()
}
