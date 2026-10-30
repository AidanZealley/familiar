import { readFileSync } from 'node:fs'
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
  return {
    name: env.FAMILIAR_NAME ?? saved.name ?? 'Familiar',
    owner: env.FAMILIAR_OWNER ?? saved.owner ?? 'owner',
    model: {
      provider: 'openai',
      modelId: env.FAMILIAR_MODEL ?? saved.model ?? 'gpt-6.1-sol',
    },
    port: validatePort(Number(env.FAMILIAR_PORT ?? saved.port ?? 4317)),
  }
}
