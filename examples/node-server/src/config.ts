import { resolve } from 'node:path'

/** Settings from the environment, read once and checked before anything opens. */
const required = (name: string) => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Set ${name} in .env. See .env.example.`)
  }
  return value
}

const port = Number(process.env.PORT ?? 4320)

export const config = {
  name: process.env.FAMILIAR_NAME ?? 'Familiar',
  owner: process.env.FAMILIAR_OWNER ?? 'Owner',
  password: required('FAMILIAR_PASSWORD'),
  sessionSecret: required('FAMILIAR_SESSION_SECRET'),
  // Pi reads it from the environment itself; checked here for a clear error.
  openRouterKey: required('OPENROUTER_API_KEY'),
  dataDir: resolve(process.env.FAMILIAR_DATA_DIR ?? 'data'),
  port,
  /**
   * Where browsers reach this server. Behind an HTTPS proxy the server only
   * sees HTTP, so this, not the request, decides whether cookies are Secure.
   */
  origin: new URL(process.env.FAMILIAR_ORIGIN ?? `http://localhost:${port}`),
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
}

if (config.sessionSecret.length < 32) {
  throw new Error('FAMILIAR_SESSION_SECRET must be at least 32 characters.')
}
