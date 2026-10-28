import { Hono } from 'hono'
import { validator } from 'hono/validator'

/** A browser's push subscription, as `PushSubscription.toJSON()` gives it. */
export type PushSubscriptionJson = {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
}

/**
 * Web Push, which the host owns: its keys and subscriptions live with the
 * host, and it delivers Familiar's `notify` to them. Core only routes to it.
 */
export type PushHost = {
  /** The VAPID public key browsers subscribe with, base64url. */
  publicKey(): string | Promise<string>
  subscribe(subscription: PushSubscriptionJson): Promise<void>
  unsubscribe(subscription: PushSubscriptionJson): Promise<void>
}

const subscription = validator('json', (body, c) => {
  const keys = body?.keys as Partial<PushSubscriptionJson['keys']> | undefined
  if (
    typeof body?.endpoint !== 'string' ||
    !URL.canParse(body.endpoint) ||
    typeof keys?.p256dh !== 'string' ||
    typeof keys.auth !== 'string'
  ) {
    return c.json({ error: 'a push subscription is required' }, 400)
  }
  return body as PushSubscriptionJson
})

/**
 * Push routes, mounted at `/push` by the HTTP API. Each answers 404 when the
 * host has no push, so clients can tell notifications aren't available.
 */
export const pushRoutes = (push: PushHost | undefined) =>
  new Hono()
    .get('/key', async (c) =>
      push
        ? c.json({ key: await push.publicKey() }, 200)
        : c.json({ error: 'push is not available' }, 404),
    )
    .post('/subscriptions', subscription, async (c) => {
      if (!push) {
        return c.json({ error: 'push is not available' }, 404)
      }
      await push.subscribe(c.req.valid('json'))
      return c.body(null, 204)
    })
    .delete('/subscriptions', subscription, async (c) => {
      if (!push) {
        return c.json({ error: 'push is not available' }, 404)
      }
      await push.unsubscribe(c.req.valid('json'))
      return c.body(null, 204)
    })
