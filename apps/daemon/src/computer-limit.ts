import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { readSettings, saveSettings } from './settings.ts'

/**
 * How many computers Familiars may have, read live wherever it's kept, so a
 * change applies without a restart.
 */
export type ComputerLimit = {
  get(): number
  set(maxComputers: number): void
}

/** The installation's limit: `maxComputers` in its `settings.json`. */
export const settingsComputerLimit = (dataDir: string): ComputerLimit => ({
  get: () => readSettings(dataDir, {}).maxComputers,
  set: (maxComputers) =>
    saveSettings(dataDir, {
      ...readSettings(dataDir, {}).explicit,
      maxComputers,
    }),
})

/** The limit, mounted at `/computer-limit`: `{ maxComputers }` to read or replace. */
export const computerLimitRoutes = (limit: ComputerLimit) =>
  new Hono()
    .get('/', (c) => c.json({ maxComputers: limit.get() }))
    .put(
      '/',
      validator('json', (body, c) => {
        const maxComputers: unknown = body?.maxComputers
        return Number.isInteger(maxComputers) && (maxComputers as number) >= 0
          ? { maxComputers: maxComputers as number }
          : c.json(
              { error: 'maxComputers must be a whole number, 0 or more' },
              400,
            )
      }),
      (c) => {
        limit.set(c.req.valid('json').maxComputers)
        return c.body(null, 204)
      },
    )
