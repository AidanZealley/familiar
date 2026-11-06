import { createHash, timingSafeEqual } from 'node:crypto'
import type { Author } from '@familiar-ai/core'
import { Hono } from 'hono'
import { deleteCookie, setSignedCookie } from 'hono/cookie'
import { parseSigned } from 'hono/utils/cookie'
import { config } from './config.ts'

/**
 * One owner, signed in with a password, kept signed in by a signed cookie
 * holding when they signed in. Cookies are sent by the browser on every
 * request, so the server checks CSRF in front of everything (server.ts).
 */

const COOKIE = 'familiar_session'
const MAX_AGE = 30 * 24 * 60 * 60

export const owner: Author = { id: 'owner', name: config.owner }

// Hashing first gives equal lengths, so the comparison takes the same time.
const digest = (value: string) => createHash('sha256').update(value).digest()
const isPassword = (given: string) =>
  timingSafeEqual(digest(given), digest(config.password))

/** The owner if the request carries a valid, unexpired session. */
export async function authenticate(request: Request) {
  const cookies = request.headers.get('cookie')
  if (!cookies) {
    return undefined
  }
  const signedIn = (await parseSigned(cookies, config.sessionSecret, COOKIE))[
    COOKIE
  ]
  return signedIn && Date.now() - Number(signedIn) < MAX_AGE * 1000
    ? owner
    : undefined
}

export const authRoutes = new Hono()
  .get('/me', async (c) =>
    (await authenticate(c.req.raw))
      ? c.json(owner)
      : c.json({ error: 'Signed out.' }, 401),
  )
  .post('/sign-in', async (c) => {
    const { password } = await c.req
      .json<{ password?: unknown }>()
      .catch(() => ({ password: undefined }))
    if (typeof password !== 'string' || !isPassword(password)) {
      return c.json({ error: 'That password is wrong.' }, 401)
    }
    await setSignedCookie(c, COOKIE, String(Date.now()), config.sessionSecret, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: new URL(c.req.url).protocol === 'https:',
      path: '/',
      maxAge: MAX_AGE,
    })
    return c.body(null, 204)
  })
  .post('/sign-out', (c) => {
    deleteCookie(c, COOKIE, { path: '/' })
    return c.body(null, 204)
  })
