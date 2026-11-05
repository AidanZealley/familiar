import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'

const nonEmpty = 'must be a non-empty string'
const text = z.string(nonEmpty).trim().min(1, nonEmpty).optional()
const port = 'must be an integer between 1 and 65535'

/** What `settings.json` may hold. Anything left out follows the release's default. */
const Settings = z.object(
  {
    name: text,
    /** The owner's name, as the model sees it on their messages. */
    owner: text,
    /** The OpenAI model to start on; the first chat model when unset. */
    model: text,
    port: z.int(port).min(1, port).max(65535, port).optional(),
  },
  { error: 'must be a JSON object' },
)
type Settings = z.infer<typeof Settings>

/** Valid settings, or an error naming the first field to fix. */
const parse = (value: unknown) => {
  const result = Settings.safeParse(value)
  if (!result.success) {
    const [issue] = result.error.issues
    throw new Error(`${issue.path.join('.') || 'settings'} ${issue.message}.`)
  }
  return result.data
}

/** Saved settings belong to the installation; environment overrides are per run. */
export function readSettings(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const path = resolve(dataDir, 'settings.json')
  let saved: Settings = {}
  try {
    saved = parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(
        `Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }
  const explicit = parse({
    ...saved,
    ...(env.FAMILIAR_NAME !== undefined && { name: env.FAMILIAR_NAME }),
    ...(env.FAMILIAR_OWNER !== undefined && { owner: env.FAMILIAR_OWNER }),
    ...(env.FAMILIAR_MODEL !== undefined && { model: env.FAMILIAR_MODEL }),
    ...(env.FAMILIAR_PORT !== undefined && {
      port: Number(env.FAMILIAR_PORT),
    }),
  })
  return {
    explicit,
    name: explicit.name ?? 'Familiar',
    owner: explicit.owner ?? 'owner',
    port: explicit.port ?? 4317,
  }
}

/** Save explicit choices, allowing defaults to follow future releases. */
export function saveSettings(dataDir: string, settings: Settings) {
  const path = resolve(dataDir, 'settings.json')
  const content = JSON.stringify(parse(settings), null, 2) + '\n'
  if (existsSync(path) && readFileSync(path, 'utf8') === content) {
    return false
  }
  writeFileSync(`${path}.tmp`, content, { mode: 0o600 })
  renameSync(`${path}.tmp`, path)
  return true
}
