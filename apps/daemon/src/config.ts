import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ModelChoice } from '@familiar-ai/core'
import { resolvePaths } from './paths.ts'
import { readSettings } from './settings.ts'

/**
 * The models this installation may offer, each with the reasoning level it
 * starts on: each provider's flagship, then a faster, cheaper one. Only
 * those whose provider has a credential are offered (see `offeredModels`),
 * everywhere: the chat picker, the memory model setting, its default level
 * and its compaction thresholds. The first offered is the default chat model.
 */
const modelChoices = [
  choice('openai', 'gpt-6.1-sol', 'low'),
  choice('openai', 'gpt-6-luna', 'medium'),
  choice('anthropic', 'claude-opus-5-5', 'medium'),
  choice('anthropic', 'claude-haiku-5-5', 'low'),
  choice('google', 'gemini-4-argon', 'medium'),
  choice('google', 'gemini-3.8-flash', 'low'),
  choice('openrouter', 'anthropic/claude-opus-5.5', 'medium'),
  choice('openrouter', 'openai/gpt-6-luna', 'low'),
  choice('xai', 'grok-4.7', 'medium'),
  choice('xai', 'grok-4.3', 'low'),
  choice('groq', 'openai/gpt-oss-120b', 'medium'),
  choice('groq', 'openai/gpt-oss-20b', 'low'),
  choice('mistral', 'mistral-large-4', 'high'),
  choice('mistral', 'mistral-small-2603', 'off'),
]

function choice(
  provider: string,
  modelId: string,
  thinkingLevel: ModelChoice['thinkingLevel'],
): ModelChoice {
  return { model: { provider, modelId }, thinkingLevel }
}

const paths = resolvePaths()
const settings = readSettings(paths.dataDir)

/**
 * The installation's configuration, read once. Reading creates nothing: the
 * daemon and sign-in create the data directory before they write to it.
 */
export const config = {
  ...paths,
  ...settings,
  host: process.env.FAMILIAR_HOST ?? '127.0.0.1',
  modelChoices,
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
