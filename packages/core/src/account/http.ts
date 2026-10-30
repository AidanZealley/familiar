import { Hono } from 'hono'
import type { AccountApi } from './index.ts'

/**
 * The owner's login, mounted at `/account`. Its state also streams live from
 * `/events`, so a sign-in's code shows up there.
 */
export const accountRoutes = (account: AccountApi) =>
  new Hono()
    .get('/', (c) => c.json(account.state()))
    .post('/sign-in', (c) => {
      account.signIn()
      return c.body(null, 202)
    })
    .delete('/sign-in', (c) => {
      account.cancelSignIn()
      return c.body(null, 204)
    })
    .post('/sign-out', async (c) => {
      await account.signOut()
      return c.body(null, 204)
    })
