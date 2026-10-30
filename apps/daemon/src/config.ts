import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { ChatModel } from '@familiar/core'

const root = resolve(import.meta.dirname, '../../..')

// Outside the repo, so nothing private can be committed, and deleting or
// re-cloning the code never loses the assistant. The XDG default on Linux.
const defaultDataDir = resolve(
  process.env.XDG_DATA_HOME ?? resolve(homedir(), '.local/share'),
  'familiar',
)

export const config = {
  dataDir: resolve(process.env.FAMILIAR_DATA_DIR ?? defaultDataDir),
  webDir: resolve(root, 'apps/web/dist'),
  host: process.env.FAMILIAR_HOST ?? '127.0.0.1',
  port: Number(process.env.FAMILIAR_PORT ?? 4317),
  name: process.env.FAMILIAR_NAME ?? 'Familiar',
  /**
   * What memory upkeep runs on, and what the chat starts on until the owner
   * picks another. Must be one of `chatModels`.
   */
  model: {
    provider: 'openai',
    modelId: process.env.FAMILIAR_MODEL ?? 'gpt-6.1-sol',
  },
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
  /** Who the daemon's one user is. The network (Tailscale) is the auth. */
  owner: process.env.FAMILIAR_OWNER ?? 'owner',
  /**
   * Sent to push services (Apple, Google, Mozilla) with each notification, so
   * they can reach whoever runs this sender. A mailto: or https: URL.
   */
  pushContact:
    process.env.FAMILIAR_PUSH_CONTACT ?? 'mailto:familiar@example.com',
}

// Private to this user even if the directory already existed. Holds the
// ChatGPT login and the whole conversation.
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
chmodSync(config.dataDir, 0o700)

export const dataPath = (name: string) => resolve(config.dataDir, name)

/** This installation's stable ID; OpenAI identifies the app's logins by it. */
export function deviceId() {
  const path = dataPath('device-id')
  if (!existsSync(path)) {
    writeFileSync(path, randomUUID(), { mode: 0o600 })
  }
  return readFileSync(path, 'utf8').trim()
}
