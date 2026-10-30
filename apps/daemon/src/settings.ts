import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Settings = {
  name?: string
  owner?: string
  model?: string
  port?: number
}

function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a settings object.')
  }
  const settings = value as Record<string, unknown>
  for (const key of ['name', 'owner', 'model']) {
    if (
      settings[key] !== undefined &&
      (typeof settings[key] !== 'string' || !settings[key].trim())
    ) {
      throw new Error(`${key} must be a non-empty string.`)
    }
  }
  if (settings.port !== undefined) {
    validatePort(settings.port)
  }
  return settings as Settings
}

function validatePort(port: unknown): number {
  if (
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('port must be an integer between 1 and 65535.')
  }
  return port
}

/** Saved settings belong to the installation; environment overrides are per run. */
export function readSettings(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const path = resolve(dataDir, 'settings.json')
  let saved: Settings = {}
  try {
    saved = validateSettings(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(
        `Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }
  const explicit = { ...saved }
  for (const key of ['name', 'owner', 'model'] as const) {
    const value = env[`FAMILIAR_${key.toUpperCase()}`]
    if (value !== undefined) {
      explicit[key] = value
    }
  }
  if (env.FAMILIAR_PORT !== undefined) {
    explicit.port = Number(env.FAMILIAR_PORT)
  }
  validateSettings(explicit)
  return {
    explicit,
    name: explicit.name ?? 'Familiar',
    owner: explicit.owner ?? 'owner',
    model: {
      provider: 'openai',
      modelId: explicit.model ?? 'gpt-6.1-sol',
    },
    port: explicit.port ?? 4317,
  }
}

/** Save explicit choices, allowing defaults to follow future releases. */
export function saveSettings(dataDir: string, settings: Settings) {
  const path = resolve(dataDir, 'settings.json')
  const content = JSON.stringify(validateSettings(settings), null, 2) + '\n'
  if (existsSync(path) && readFileSync(path, 'utf8') === content) {
    return false
  }
  writeFileSync(`${path}.tmp`, content, { mode: 0o600 })
  renameSync(`${path}.tmp`, path)
  return true
}
