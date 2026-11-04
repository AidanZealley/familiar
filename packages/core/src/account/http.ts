import { Hono, type Context } from 'hono'
import { validator } from 'hono/validator'
import type { AccountApi } from './index.ts'

const unavailable = (c: Context) =>
  c.json({ error: 'account management is not available' }, 404)

/**
 * The owner's login, mounted at `/account`, one route each. Its state also
 * streams live from `/events`, so a sign-in's page and code show up there.
 * Each route answers 404 when the host manages credentials itself and
 * attached no account.
 */
export const accountOperations = (account: AccountApi | undefined) => ({
  state: new Hono().get('/', (c) =>
    account ? c.json(account.state(), 200) : unavailable(c),
  ),
  signIn: new Hono().post('/sign-in', (c) => {
    if (!account) {
      return unavailable(c)
    }
    account.signIn()
    return c.body(null, 202)
  }),
  // The address the browser ended on, when the state asks for it. Without
  // an account, 404 whatever the body.
  answerSignIn: new Hono().post(
    '/sign-in/answer',
    async (c, next) => (account ? next() : unavailable(c)),
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
  ),
  cancelSignIn: new Hono().delete('/sign-in', (c) => {
    if (!account) {
      return unavailable(c)
    }
    account.cancelSignIn()
    return c.body(null, 204)
  }),
  signOut: new Hono().post('/sign-out', async (c) => {
    if (!account) {
      return unavailable(c)
    }
    await account.signOut()
    return c.body(null, 204)
  }),
})

/** Every account route, mounted at `/account`. */
export const accountRoutes = (account: AccountApi | undefined) => {
  const operations = accountOperations(account)
  return new Hono()
    .route('/', operations.state)
    .route('/', operations.signIn)
    .route('/', operations.answerSignIn)
    .route('/', operations.cancelSignIn)
    .route('/', operations.signOut)
}
