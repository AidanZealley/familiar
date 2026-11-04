import { Hono, type Context } from 'hono'
import { validator } from 'hono/validator'
import { can, type AccessEnv } from '../http/access.ts'
import type { AccountApi } from './index.ts'

const unavailable = (c: Context) =>
  c.json({ error: 'account management is not available' }, 404)

/**
 * The owner's login, mounted at `/account`. Its state also streams live from
 * `/events`, so a sign-in's page shows up there. Each route answers 404 when
 * the host manages credentials itself and passed no `account`.
 */
export const accountRoutes = (account: AccountApi | undefined) =>
  new Hono<AccessEnv>()
    .get('/', can('account.state'), (c) =>
      account ? c.json(account.state(), 200) : unavailable(c),
    )
    .post('/sign-in', can('account.signIn'), (c) => {
      if (!account) {
        return unavailable(c)
      }
      account.signIn()
      return c.body(null, 202)
    })
    .post(
      '/sign-in/answer',
      can('account.answerSignIn'),
      // The address the browser ended on, when the state asks for it.
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
    .delete('/sign-in', can('account.cancelSignIn'), (c) => {
      if (!account) {
        return unavailable(c)
      }
      account.cancelSignIn()
      return c.body(null, 204)
    })
    .post('/sign-out', can('account.signOut'), async (c) => {
      if (!account) {
        return unavailable(c)
      }
      await account.signOut()
      return c.body(null, 204)
    })
