import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ModelChoice } from '@familiar-ai/core'
import { resolvePaths } from './paths.ts'
import { readSettings } from './settings.ts'

/**
 * The models this installation may offer, each starting on its maker's
 * default reasoning level: OpenAI's as its ChatGPT sign-in sets them, and
 * medium where none is documented. OpenRouter is here for open-weight models,
 * the main Chinese families' flagships. Only those whose provider has a
 * credential are offered (see `offeredModels`), everywhere: the chat picker,
 * the memory model setting, its default level and its compaction thresholds.
 * The first offered is the default chat model.
 */
const modelChoices = [
  choice('openai', 'gpt-6.1-sol', 'low'),
  choice('openai', 'gpt-6.1-terra', 'low'),
  choice('openai', 'gpt-6-luna', 'medium'),
  choice('openai', 'gpt-6-astra', 'medium'),
  choice('anthropic', 'claude-fable-5-2', 'high'),
  choice('anthropic', 'claude-opus-5-5', 'medium'),
  choice('anthropic', 'claude-sonnet-5-5', 'high'),
  choice('anthropic', 'claude-haiku-5-5', 'medium'),
  choice('google', 'gemini-4-argon', 'medium'),
  choice('google', 'gemini-3.8-flash', 'medium'),
  choice('google', 'gemini-flash-lite-latest', 'medium'),
  choice('xai', 'grok-4.7', 'high'),
  choice('xai', 'grok-4.6', 'high'),
  choice('xai', 'grok-4.5', 'high'),
  choice('xai', 'grok-4.3', 'low'),
  choice('openrouter', 'deepseek/deepseek-v4-pro', 'high'),
  choice('openrouter', 'moonshotai/kimi-k3', 'max'),
  choice('openrouter', 'z-ai/glm-5.3', 'max'),
  choice('openrouter', 'minimax/minimax-m3', 'medium'),
  choice('openrouter', 'qwen/qwen3.8-2.4t-a95b', 'xhigh'),
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
  /**
   * Where Docker computers reach this daemon, as `host:port` from the Docker
   * host (`DOCKER_HOST`, else this machine): such as
   * `host.docker.internal:4317` with the daemon listening beyond 127.0.0.1.
   * Setting it lets the owner give Familiars Docker computers.
   */
  dockerComputers: process.env.FAMILIAR_DOCKER_COMPUTERS,
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
