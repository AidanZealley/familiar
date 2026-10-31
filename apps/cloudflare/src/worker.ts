import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { bearerAuth } from 'hono/bearer-auth'
import { timingSafeEqual } from 'hono/utils/buffer'
import type { Env } from './env.ts'

export { Bot } from './bot.ts'
export { Outbox } from './outbox.ts'

type App = { Bindings: Env }

/** A bot's routes. Each name is its own Durable Object and its own Familiar. */
const BOT = '/bots/:name{[a-z0-9-]{1,64}}'

const bot = (c: Context<App>) =>
  c.env.BOTS.get(c.env.BOTS.idFromName(c.req.param('name')!))

const outbox = (c: Context<App>) => {
  const id = c.env.BOTS.idFromName(c.req.param('name')!).toString()
  return c.env.OUTBOX.get(c.env.OUTBOX.idFromName(id))
}

export default new Hono<App>()
  // Every route needs the token; without one configured, nothing is served.
  .use(
    bearerAuth({
      verifyToken: async (token, c: Context<App>) => {
        const expected = c.env.FAMILIAR_DEV_TOKEN
        return !!expected && (await timingSafeEqual(token, expected))
      },
    }),
  )
  .use(bodyLimit({ maxSize: 64 * 1024 }))
  // Familiar's own HTTP API, as in the daemon, under the bot's name.
  .all(`${BOT}/api/*`, (c) => {
    const url = new URL(c.req.url)
    url.pathname = url.pathname.replace(/^\/bots\/[^/]+\/api/, '')
    return bot(c).fetch(new Request(url, c.req.raw))
  })
  .get(`${BOT}/status`, async (c) => c.json(await bot(c).status()))
  .get(`${BOT}/notifications`, async (c) => c.json(await outbox(c).list()))
  // Ends the bot for good, keeping its history. Its name can't be reused.
  .post(`${BOT}/terminate`, async (c) => {
    await bot(c).terminate()
    return c.body(null, 204)
  })
