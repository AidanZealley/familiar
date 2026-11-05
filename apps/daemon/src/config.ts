import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ChatModel } from '@familiar-ai/core'
import { resolvePaths } from './paths.ts'
import { readSettings } from './settings.ts'

/**
 * The models the chat can switch between, each with the reasoning level it
 * starts on. Adding a model here offers it everywhere: the picker, its
 * default level and its compaction thresholds. The first is the default.
 */
const chatModels = [
  {
    model: { provider: 'openai', modelId: 'gpt-6.1-sol' },
    thinkingLevel: 'low',
  },
  {
    model: { provider: 'openai', modelId: 'gpt-6-luna' },
    thinkingLevel: 'medium',
  },
] satisfies ChatModel[]

const paths = resolvePaths()
const settings = readSettings(paths.dataDir)

/**
 * The installation's configuration, read once. Reading creates nothing: the
 * daemon and sign-in create the data directory before they write to it.
 */
export const config = {
  ...paths,
  ...settings,
  model: settings.explicit.model
    ? { provider: 'openai', modelId: settings.explicit.model }
    : chatModels[0].model,
  host: process.env.FAMILIAR_HOST ?? '127.0.0.1',
  chatModels,
  /** Sent to push services so they can contact the installation's owner. */
  pushContact:
    process.env.FAMILIAR_PUSH_CONTACT ?? 'mailto:familiar@example.com',
}

export const dataPath = (name: string) => resolve(config.dataDir, name)

/** This installation's stable ID; OpenAI identifies the app's logins by it. */
export function deviceId() {
  const path = dataPath('device-id')
  if (!existsSync(path)) {
    writeFileSync(path, randomUUID(), { mode: 0o600 })
  }
  return readFileSync(path, 'utf8').trim()
}
