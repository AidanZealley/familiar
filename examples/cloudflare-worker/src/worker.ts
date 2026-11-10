import { Hono, type Context } from 'hono'
import { bearerAuth } from 'hono/bearer-auth'
import { timingSafeEqual } from 'hono/utils/buffer'
import type { Env } from './env.ts'

type App = { Bindings: Env }

export { Bot } from './bot.ts'

/**
 * `/bots/<name>/api/*` is Familiar's HTTP API for the bot of that name, each
 * its own Durable Object and workspace. One bearer token guards every route.
 */
export default new Hono<App>()
  // Without a configured token, nothing is served.
  .use(
    bearerAuth({
      verifyToken: async (token, c: Context<App>) => {
        const expected = c.env.FAMILIAR_TOKEN
        return !!expected && (await timingSafeEqual(token, expected))
      },
    }),
  )
  .all('/bots/:name{[a-z0-9-]{1,64}}/api/*', (c) => {
    const bot = c.env.BOTS.get(c.env.BOTS.idFromName(c.req.param('name')))
    const url = new URL(c.req.url)
    url.pathname = url.pathname.replace(/^\/bots\/[^/]+\/api/, '')
    return bot.fetch(new Request(url, c.req.raw))
  })
