import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ChatModel } from '@familiar-ai/core'
import { ensureDataDir, resolvePaths } from './paths.ts'
import { readSettings } from './settings.ts'

const paths = resolvePaths()

export const config = {
  ...paths,
  ...readSettings(paths.dataDir),
  host: process.env.FAMILIAR_HOST ?? '127.0.0.1',
  /**
   * The models the chat can switch between, each with the reasoning level it
   * starts on. Adding a model here offers it everywhere: the picker, its
   * default level and its compaction thresholds.
   */
  chatModels: [
    {
      model: { provider: 'openai', modelId: 'gpt-6.1-sol' },
      thinkingLevel: 'low',
    },
    {
      model: { provider: 'openai', modelId: 'gpt-6-luna' },
      thinkingLevel: 'medium',
    },
  ] satisfies ChatModel[],
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
