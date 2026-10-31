import { Hono, type Context } from 'hono'
import { validator } from 'hono/validator'
import type { AccountApi } from './index.ts'

const unavailable = (c: Context) =>
  c.json({ error: 'account management is not available' }, 404)

/**
 * The owner's login, mounted at `/account`. Its state also streams live from
 * `/events`, so a sign-in's page and code show up there. Each route answers
 * 404 when the host manages credentials itself and attached no account.
 */
export const accountRoutes = (account: AccountApi | undefined) =>
  new Hono()
    .use(async (c, next) => {
      if (!account) {
        return unavailable(c)
      }
      await next()
    })
    .get('/', (c) => (account ? c.json(account.state(), 200) : unavailable(c)))
    .post('/sign-in', (c) => {
      if (!account) {
        return unavailable(c)
      }
      account.signIn()
      return c.body(null, 202)
    })
    // The address the browser ended on, when the state asks for it.
    .post(
      '/sign-in/answer',
      validator('json', (body, c) => {
        if (typeof body?.text !== 'string' || !body.text.trim()) {
          return c.json({ error: 'text is required' }, 400)
        }
        return { text: (body.text as string).trim() }
      }),
      (c) => {
        if (!account) {
          return unavailable(c)
        }
        account.answer(c.req.valid('json').text)
        return c.body(null, 202)
      },
    )
    .delete('/sign-in', (c) => {
      if (!account) {
        return unavailable(c)
      }
      account.cancelSignIn()
      return c.body(null, 204)
    })
    .post('/sign-out', async (c) => {
      if (!account) {
        return unavailable(c)
      }
      await account.signOut()
      return c.body(null, 204)
    })
