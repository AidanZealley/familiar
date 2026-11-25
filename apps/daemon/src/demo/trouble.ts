import type { MiddlewareHandler } from 'hono'

/** How long the demo holds a request it slows down. */
const HOLD_MS = 4000

const held = () => new Promise((done) => setTimeout(done, HOLD_MS))

/** `bytes`' SHA-256, to know an image again. */
const digest = async (bytes: ArrayBuffer) =>
  Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex')

/**
 * The demo's rough network, so its sending states can be seen: words in a
 * message turn it on, for the demo only.
 *
 * - `#slow` in a message holds its post, so it stays pending a while.
 * - `#fail` in a message refuses its first post, as a lost connection
 *   would, so it turns into the failed item; Retry, which keeps its
 *   request ID, goes through.
 * - `#trouble` in a message turns rough uploads on or off: each new image
 *   fails its first two uploads, one more than the automatic retry, so its
 *   tile shows the failure to tap, and every upload is held while it's
 *   "prepared".
 */
export function demoTrouble(): MiddlewareHandler {
  let rough = false
  const refusedPosts = new Set<string>()
  const failedUploads = new Map<string, number>()

  return async (c, next) => {
    if (c.req.method !== 'POST') {
      return next()
    }
    if (/^\/api\/rooms\/[^/]+\/images$/.test(c.req.path) && rough) {
      const image = await digest(await c.req.arrayBuffer())
      const failures = failedUploads.get(image) ?? 0
      if (failures < 2) {
        failedUploads.set(image, failures + 1)
        // No code: to the client, an upload that never got an answer.
        return c.json({ error: 'The demo dropped this upload.' }, 503)
      }
      await held()
      return next()
    }
    if (/^\/api\/rooms\/[^/]+\/messages$/.test(c.req.path)) {
      type Message = { text?: string; requestId?: string }
      const { text = '', requestId = '' } = await c.req
        .json<Message>()
        .catch((): Message => ({}))
      if (text.includes('#trouble')) {
        rough = !rough
        failedUploads.clear()
      }
      if (text.includes('#fail') && !refusedPosts.has(requestId)) {
        refusedPosts.add(requestId)
        return c.json({ error: 'The demo dropped this message.' }, 503)
      }
      if (text.includes('#slow')) {
        await held()
      }
    }
    return next()
  }
}
