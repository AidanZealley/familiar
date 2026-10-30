import { Hono } from 'hono'
import { validator } from 'hono/validator'
import type { AccountApi } from './index.ts'

/**
 * The owner's login, mounted at `/account`. Its state also streams live from
 * `/events`, so a sign-in's page and code show up there.
 */
export const accountRoutes = (account: AccountApi) =>
  new Hono()
    .get('/', (c) => c.json(account.state()))
    .post('/sign-in', (c) => {
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
        account.answer(c.req.valid('json').text)
        return c.body(null, 202)
      },
    )
    .delete('/sign-in', (c) => {
      account.cancelSignIn()
      return c.body(null, 204)
    })
    .post('/sign-out', async (c) => {
      await account.signOut()
      return c.body(null, 204)
    })
