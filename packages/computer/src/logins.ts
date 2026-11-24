import type { FamiliarId, PluginContext, PluginEnv } from '@familiar-ai/core'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'

/** A site's origin: HTTPS, or HTTP on localhost. */
export const siteOrigin = z.url().transform((value, context) => {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && url.hostname === 'localhost')
  ) {
    context.addIssue({ code: 'custom', message: 'Expected an HTTPS site' })
    return z.NEVER
  }
  return url.origin
})

const loginKey = z.strictObject({
  origin: siteOrigin,
  username: z.string().min(1),
})
const login = loginKey.extend({ password: z.string().min(1) })

export type Login = z.output<typeof login>
type LoginKey = z.output<typeof loginKey>

/** Its secret's name: each Familiar's logins are one encrypted JSON list. */
export const LOGINS = 'logins'

const matches = (a: LoginKey) => (b: LoginKey) =>
  a.origin === b.origin && a.username === b.username

/**
 * Each Familiar's saved logins, one per site and username, as one secret.
 * Core runs each Familiar's changes one at a time and deletes them when it
 * is removed, so a save from the owner's settings and one from the chat
 * can't lose each other, and none outlives its Familiar.
 */
export function computerLogins() {
  let secretsFor: PluginContext['secretsFor']

  const secrets = (familiar: FamiliarId) => {
    const secrets = secretsFor?.(familiar)
    if (!secrets) {
      throw new HTTPException(503, {
        message: "This host keeps no secrets, so it can't save logins.",
      })
    }
    return secrets
  }
  const parsed = (saved: string | undefined) =>
    (saved ? JSON.parse(saved) : []) as Login[]

  const read = async (familiar: FamiliarId) =>
    parsed(await secrets(familiar).get(LOGINS))

  /** Changes `familiar`'s list in place with `work`, after any earlier change. */
  const change = (familiar: FamiliarId, work: (logins: Login[]) => void) =>
    secrets(familiar).update(LOGINS, (saved) => {
      const logins = parsed(saved)
      work(logins)
      return logins.length ? JSON.stringify(logins) : undefined
    })

  const list = async (familiar: FamiliarId) =>
    (await read(familiar)).map(({ origin, username }) => ({ origin, username }))

  const save = (familiar: FamiliarId, value: Login) =>
    change(familiar, (logins) => {
      const index = logins.findIndex(matches(value))
      logins.splice(index === -1 ? logins.length : index, 1, value)
    })

  const parse = async <T extends z.ZodType>(
    schema: T,
    body: Promise<unknown>,
  ) => {
    const parsed = schema.safeParse(await body.catch(() => null))
    if (!parsed.success) {
      throw new HTTPException(400, { message: 'Invalid login' })
    }
    return parsed.data as z.output<T>
  }

  return {
    open: (context: PluginContext) => {
      secretsFor = context.secretsFor
    },
    /** `familiar`'s logins, without their passwords. */
    list,
    find: async (familiar: FamiliarId, key: LoginKey) =>
      (await read(familiar)).find(matches(key)),
    /** Adds it, or replaces the password of the one with its site and username. */
    save,
    routes: new Hono<PluginEnv>()
      .get('/', async (c) => c.json(await list(c.get('familiar'))))
      .put('/', async (c) => {
        await save(c.get('familiar'), await parse(login, c.req.json()))
        return c.body(null, 204)
      })
      .delete('/', async (c) => {
        const key = await parse(loginKey, c.req.json())
        await change(c.get('familiar'), (logins) => {
          const index = logins.findIndex(matches(key))
          if (index !== -1) {
            logins.splice(index, 1)
          }
        })
        return c.body(null, 204)
      }),
  }
}

export type ComputerLogins = ReturnType<typeof computerLogins>
